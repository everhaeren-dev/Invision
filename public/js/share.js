// ── State ────────────────────────────────────────────────────────────────────
const shareToken = location.pathname.split('/').pop()
let project = null
let pages = []
let allComments = {}   // pageId → [comments]
let currentPageId = null
let commentMode = false
let pendingPin = null
let activePinId = null
let fitMode = false
let pendingComment = null   // { x, y } waiting for author input
let dragCounter = 0

// ── DOM refs ──────────────────────────────────────────────────────────────────
const projectName  = document.getElementById('projectName')
const pageSelect   = document.getElementById('pageSelect')
const canvasArea   = document.getElementById('canvasArea')
const canvasInner  = document.getElementById('canvasInner')
const canvasImg    = document.getElementById('canvasImg')
const retinaBadge  = document.getElementById('retinaBadge')
const noPages      = document.getElementById('noPages')
const sidebarScroll= document.getElementById('sidebarScroll')
const addCommentBtn= document.getElementById('addCommentBtn')
const commentBar   = document.getElementById('commentModeBar')
const clientPickerBackdrop = document.getElementById('clientPickerBackdrop')

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
function relTime(d) {
  const m = Math.floor((Date.now() - new Date(d)) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
function getAuthor() { return localStorage.getItem('iv_client_' + shareToken) || '' }
function setAuthor(name) { localStorage.setItem('iv_client_' + shareToken, name) }

// ── Client name picker ────────────────────────────────────────────────────────
let _onNameConfirmed = null

async function showClientPicker(onConfirm) {
  _onNameConfirmed = onConfirm
  clientPickerBackdrop.classList.remove('hidden')

  const knownName = getAuthor()
  const knownUserView = document.getElementById('knownUserView')
  const chooseView = document.getElementById('chooseView')

  if (knownName) {
    // Already have a stored name — ask to confirm
    knownUserView.classList.remove('hidden')
    chooseView.style.display = 'none'
    document.getElementById('knownUserMsg').textContent = `Vous êtes ${knownName} ?`

    document.getElementById('knownUserOui').onclick = () => {
      clientPickerBackdrop.classList.add('hidden')
      onConfirm(knownName)
    }
    document.getElementById('knownUserNon').onclick = () => {
      // Clear stored name and show full picker
      localStorage.removeItem('iv_client_' + shareToken)
      knownUserView.classList.add('hidden')
      chooseView.style.display = ''
      loadClientChips()
    }
  } else {
    knownUserView.classList.add('hidden')
    chooseView.style.display = ''
    loadClientChips()
  }
}

async function loadClientChips() {
  const names = await fetch(`/api/share/${shareToken}/clients`).then(r => r.json()).catch(() => [])
  const chipsEl = document.getElementById('clientChips')
  chipsEl.innerHTML = ''

  if (names.length) {
    names.forEach(name => {
      const chip = document.createElement('button')
      chip.style.cssText = 'padding:6px 14px;border-radius:20px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;cursor:pointer;transition:all .15s;'
      chip.textContent = name
      chip.addEventListener('mouseenter', () => { chip.style.borderColor = 'var(--accent)'; chip.style.color = 'var(--accent)' })
      chip.addEventListener('mouseleave', () => { chip.style.borderColor = 'var(--border)'; chip.style.color = 'var(--text)' })
      chip.addEventListener('click', () => {
        setAuthor(name)
        clientPickerBackdrop.classList.add('hidden')
        _onNameConfirmed && _onNameConfirmed(name)
      })
      chipsEl.appendChild(chip)
    })
  }

  document.getElementById('newVisitorBtn').onclick = () => {
    document.getElementById('newVisitorRow').style.display = 'none'
    document.getElementById('newNameRow').classList.remove('hidden')
    document.getElementById('newNameInput').focus()
  }

  document.getElementById('newNameConfirm').onclick = () => {
    const name = document.getElementById('newNameInput').value.trim()
    if (!name) { document.getElementById('newNameInput').focus(); return }
    setAuthor(name)
    clientPickerBackdrop.classList.add('hidden')
    _onNameConfirmed && _onNameConfirmed(name)
  }

  document.getElementById('newNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('newNameConfirm').click()
  })
}

// ── Load data ─────────────────────────────────────────────────────────────────
async function init() {
  const data = await fetch(`/api/share/${shareToken}`).then(r => {
    if (!r.ok) throw new Error('Not found')
    return r.json()
  }).catch(() => null)

  if (!data) {
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:var(--text2);font-size:16px">Project not found or link expired.</div>`
    return
  }

  project = data.project
  pages = data.pages
  pages.forEach(p => { allComments[p.id] = p.comments || [] })

  projectName.textContent = project.name
  document.title = `${project.name} — InVision Review`

  renderPageSelect()
  if (pages.length > 0) switchPage(pages[0].id)
  else noPages.classList.remove('hidden')

  // Show client picker if no name stored
  if (!getAuthor()) {
    showClientPicker(name => {
      // Name stored, user can now comment
    })
  }
}

// ── Page management ───────────────────────────────────────────────────────────
function renderPageSelect() {
  pageSelect.innerHTML = pages.map(p =>
    `<option value="${p.id}">${esc(p.name)}${p.is_retina ? ' (@2x)' : ''}</option>`
  ).join('')
}

function switchPage(pageId) {
  pageId = Number(pageId)
  currentPageId = pageId
  pageSelect.value = pageId
  activePinId = null
  cancelCommentMode()

  const page = pages.find(p => p.id === pageId)
  if (!page) return

  noPages.classList.add('hidden')
  canvasInner.classList.remove('hidden')
  addCommentBtn.style.display = 'flex'

  canvasImg.src = `/uploads/${project.id}/${page.filename}`
  canvasImg.onload = () => {
    if (page.is_retina) {
      canvasImg.style.width  = (canvasImg.naturalWidth  / 2) + 'px'
      canvasImg.style.height = (canvasImg.naturalHeight / 2) + 'px'
    } else {
      canvasImg.style.width  = ''
      canvasImg.style.height = ''
    }
    renderPins()
  }

  retinaBadge.classList.toggle('hidden', !page.is_retina)
  renderSidebar()
}

pageSelect.addEventListener('change', () => switchPage(Number(pageSelect.value)))

// ── Zoom ──────────────────────────────────────────────────────────────────────
document.getElementById('zoomFit').addEventListener('click', () => {
  fitMode = true
  canvasArea.classList.add('fit-mode')
  document.getElementById('zoomFit').classList.add('active')
  document.getElementById('zoom100').classList.remove('active')
})
document.getElementById('zoom100').addEventListener('click', () => {
  fitMode = false
  canvasArea.classList.remove('fit-mode')
  document.getElementById('zoom100').classList.add('active')
  document.getElementById('zoomFit').classList.remove('active')
})

// ── Comment mode ──────────────────────────────────────────────────────────────
addCommentBtn.addEventListener('click', () => {
  if (commentMode) cancelCommentMode()
  else {
    const author = getAuthor()
    if (!author) {
      showClientPicker(() => enterCommentMode())
    } else {
      enterCommentMode()
    }
  }
})

function enterCommentMode() {
  commentMode = true
  canvasArea.classList.replace('default-mode', 'comment-mode')
  commentBar.classList.remove('hidden')
  addCommentBtn.classList.add('active')
  closeAllBubbles()
}

function cancelCommentMode() {
  commentMode = false
  canvasArea.classList.replace('comment-mode', 'default-mode')
  commentBar.classList.add('hidden')
  addCommentBtn.classList.remove('active')
  if (pendingPin) { pendingPin.remove(); pendingPin = null }
  closeNewCommentForm()
}

document.getElementById('cancelCommentMode').addEventListener('click', cancelCommentMode)
document.addEventListener('keydown', e => { if (e.key === 'Escape') { cancelCommentMode(); closeAllBubbles() } })

// ── Canvas click ──────────────────────────────────────────────────────────────
canvasArea.addEventListener('click', e => {
  if (!commentMode || !currentPageId) return
  if (e.target.closest('.new-comment-form') || e.target.closest('.pin')) return

  const rect = canvasImg.getBoundingClientRect()
  if (e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top  || e.clientY > rect.bottom) return

  const x = (e.clientX - rect.left) / rect.width  * 100
  const y = (e.clientY - rect.top)  / rect.height * 100

  closeNewCommentForm()
  if (pendingPin) pendingPin.remove()

  const pp = document.createElement('div')
  pp.className = 'pending-pin'
  pp.style.left = x + '%'
  pp.style.top  = y + '%'
  canvasInner.appendChild(pp)
  pendingPin = pp

  showNewCommentForm(x, y, pp)
})

function showNewCommentForm(x, y, anchor) {
  closeNewCommentForm()
  const author = getAuthor()

  const form = document.createElement('div')
  form.className = 'new-comment-form'
  form.id = 'newCommentForm'

  const imgH = canvasImg.getBoundingClientRect().height
  const anchorY = y / 100 * imgH
  const isBelow = anchorY < imgH * 0.75
  form.classList.add(isBelow ? 'below' : 'above')
  form.style.left = Math.min(Math.max(x, 15), 85) + '%'

  form.innerHTML = `
    <div style="margin-bottom:6px;font-size:12px;color:var(--text2)">
      Posting as <strong style="color:var(--client-pin)">${esc(author)}</strong>
      <button id="changeAuthor" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:11px;text-decoration:underline;margin-left:6px">Change</button>
    </div>
    <textarea class="nc-textarea" id="ncText" placeholder="Your feedback…" rows="3"></textarea>
    <div style="display:flex;justify-content:flex-end;gap:6px">
      <button class="btn btn-ghost" style="padding:5px 10px;font-size:12px" id="ncCancel">Cancel</button>
      <button class="btn btn-primary" style="padding:5px 10px;font-size:12px" id="ncSave">Post</button>
    </div>
  `
  anchor.appendChild(form)
  form.querySelector('#ncText').focus()

  form.querySelector('#changeAuthor').addEventListener('click', e => {
    e.stopPropagation()
    cancelCommentMode()
    // Reset stored name so picker shows full selection
    localStorage.removeItem('iv_client_' + shareToken)
    showClientPicker(name => enterCommentMode())
  })
  form.querySelector('#ncCancel').addEventListener('click', e => {
    e.stopPropagation()
    cancelCommentMode()
  })
  form.querySelector('#ncSave').addEventListener('click', e => {
    e.stopPropagation()
    submitComment(x, y, form)
  })
  form.querySelector('#ncText').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitComment(x, y, form)
    e.stopPropagation()
  })
  form.addEventListener('click', e => e.stopPropagation())
}

async function submitComment(x, y, form) {
  const textEl = form.querySelector('#ncText')
  const text   = textEl.value.trim()
  const author = getAuthor()
  if (!text) { textEl.focus(); return }

  const res = await fetch(`/api/share/${shareToken}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_id: currentPageId, x, y, text, author })
  }).then(r => r.json())

  if (!allComments[currentPageId]) allComments[currentPageId] = []
  allComments[currentPageId].push({ ...res, is_team: 0 })

  cancelCommentMode()
  renderPins()
  renderSidebar()
  highlightComment(res.id)
}

function closeNewCommentForm() {
  const f = document.getElementById('newCommentForm')
  if (f) f.remove()
}

// ── Pins ──────────────────────────────────────────────────────────────────────
function renderPins() {
  document.querySelectorAll('.pin, .comment-bubble, .pending-pin').forEach(el => el.remove())
  if (!currentPageId) return
  const comments = allComments[currentPageId] || []

  comments.forEach((c, idx) => {
    const pin = document.createElement('div')
    pin.className = `pin client-pin${c.id === activePinId ? ' active' : ''}`
    pin.style.left = c.x + '%'
    pin.style.top  = c.y + '%'
    pin.textContent = idx + 1
    pin.dataset.commentId = c.id
    pin.addEventListener('click', e => {
      e.stopPropagation()
      if (commentMode) return
      activePinId = activePinId === c.id ? null : c.id
      closeAllBubbles()
      renderPins()
    })
    canvasInner.appendChild(pin)
    if (c.id === activePinId) showBubble(c, pin, idx + 1)
  })
}

function showBubble(comment, pin, num) {
  const rect = canvasImg.getBoundingClientRect()
  const pinY = comment.y / 100 * rect.height

  const bubble = document.createElement('div')
  bubble.className = 'comment-bubble'
  const isBelow = pinY < rect.height * 0.75
  bubble.classList.add(isBelow ? 'below' : 'above')
  bubble.style.left = Math.min(Math.max(comment.x, 15), 85) + '%'

  const replies = comment.replies || []
  const repliesHtml = replies.map(r => `
    <div class="reply-item">
      <div class="reply-header">
        <span class="ci-author" style="font-size:11px">${esc(r.author)}</span>
        <span class="tag ${r.is_team ? 'tag-team' : 'tag-client'}" style="font-size:9px;padding:1px 5px">${r.is_team ? 'Team' : 'Client'}</span>
        <span class="bubble-time">${relTime(r.created_at)}</span>
      </div>
      <div class="reply-text">${esc(r.text)}</div>
    </div>
  `).join('')

  const isResolved = comment.status === 'resolved'

  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="ci-pin client" style="width:20px;height:20px;font-size:10px">${num}</span>
      <span class="bubble-author">${esc(comment.author)}</span>
      <span class="bubble-time">${relTime(comment.created_at)}</span>
      ${isResolved ? '<span class="resolved-badge" style="margin-left:auto">✓ Résolu</span>' : ''}
    </div>
    <div class="bubble-text${isResolved ? ' resolved-text' : ''}">${esc(comment.text)}</div>
    ${replies.length ? `<div class="replies-thread">${repliesHtml}</div>` : ''}
    <div class="reply-form" id="replyForm-${comment.id}">
      <textarea class="nc-textarea reply-textarea" placeholder="Répondre…" rows="2" id="shareReplyText-${comment.id}"></textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:6px">
        <button class="btn btn-primary" style="padding:4px 10px;font-size:12px" id="shareReplySend-${comment.id}">Répondre</button>
      </div>
    </div>
  `

  bubble.querySelector(`#shareReplySend-${comment.id}`).addEventListener('click', async e => {
    e.stopPropagation()
    const textarea = bubble.querySelector(`#shareReplyText-${comment.id}`)
    const text = textarea.value.trim()
    if (!text) { textarea.focus(); return }
    let author = getAuthor()
    if (!author) {
      showClientPicker(name => { author = name })
      if (!getAuthor()) return
      author = getAuthor()
    }
    const res = await fetch(`/api/share/${shareToken}/comments/${comment.id}/replies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, author })
    }).then(r => r.json())
    if (!comment.replies) comment.replies = []
    comment.replies.push(res)
    allComments[currentPageId] = allComments[currentPageId] || []
    closeAllBubbles()
    renderPins()
    renderSidebar()
    activePinId = comment.id
    renderPins()
  })

  bubble.addEventListener('click', e => e.stopPropagation())
  pin.appendChild(bubble)
}

function closeAllBubbles() {
  document.querySelectorAll('.comment-bubble').forEach(el => el.remove())
}

canvasArea.addEventListener('click', e => {
  if (!commentMode && !e.target.closest('.pin')) {
    activePinId = null
    closeAllBubbles()
    document.querySelectorAll('.pin').forEach(p => p.classList.remove('active'))
    document.querySelectorAll('.comment-item').forEach(i => i.classList.remove('highlighted'))
  }
})

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebar() {
  const sections = pages.map(page => {
    const comments = allComments[page.id] || []
    const isOpen = page.id === currentPageId
      const listHtml = comments.map((c, idx) => {
        const replies = (c.replies || []).map(r => `
          <div class="reply-item">
            <div class="reply-header">
              <span class="ci-author" style="font-size:11px">${esc(r.author)}</span>
              <span class="tag ${r.is_team ? 'tag-team' : 'tag-client'}" style="font-size:9px;padding:1px 5px">${r.is_team ? 'Team' : 'Client'}</span>
              <span class="ci-time">${relTime(r.created_at)}</span>
            </div>
            <div class="reply-text">${esc(r.text)}</div>
          </div>
        `).join('')
        const isResolved = c.status === 'resolved'
        return `
          <div class="comment-item${c.id === activePinId ? ' highlighted' : ''}${isResolved ? ' resolved' : ''}" data-cid="${c.id}" data-pid="${page.id}">
            <div class="ci-header">
              <div class="ci-pin client">${idx + 1}</div>
              <span class="ci-author">${esc(c.author)}</span>
              <span class="ci-time">${relTime(c.created_at)}</span>
              ${isResolved ? '<span class="resolved-badge" style="margin-left:auto">✓</span>' : ''}
            </div>
            <div class="ci-text${isResolved ? ' resolved-text' : ''}">${esc(c.text)}</div>
            ${replies}
          </div>
        `
      }).join('')

    return `
      <div class="page-section" data-pid="${page.id}">
        <div class="page-section-header">
          <span class="page-section-arrow ${isOpen ? 'open' : ''}">&#9654;</span>
          <span class="page-section-name">${esc(page.name)}</span>
          ${comments.length ? `<span class="page-section-badge">${comments.length}</span>` : ''}
        </div>
        <div class="page-comments" style="${isOpen ? '' : 'display:none'}">
          ${listHtml || '<div style="padding:6px 4px;font-size:12px;color:var(--text2)">No comments yet</div>'}
        </div>
      </div>
    `
  }).join('')

  sidebarScroll.innerHTML = sections

  sidebarScroll.querySelectorAll('.page-section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.closest('.page-section')
      const pid = Number(section.dataset.pid)
      const commentsDiv = section.querySelector('.page-comments')
      const arrow = header.querySelector('.page-section-arrow')
      const isOpen = commentsDiv.style.display !== 'none'
      commentsDiv.style.display = isOpen ? 'none' : 'block'
      arrow.classList.toggle('open', !isOpen)
      if (!isOpen) switchPage(pid)
    })
  })

  sidebarScroll.querySelectorAll('.comment-item').forEach(item => {
    item.addEventListener('click', () => {
      const cid = Number(item.dataset.cid)
      const pid = Number(item.dataset.pid)
      if (pid !== currentPageId) {
        switchPage(pid)
        setTimeout(() => highlightComment(cid), 300)
      } else {
        highlightComment(cid)
      }
    })
  })
}

function highlightComment(commentId) {
  activePinId = commentId
  renderPins()
  renderSidebar()
  const item = sidebarScroll.querySelector(`[data-cid="${commentId}"]`)
  if (item) item.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  const pin = canvasInner.querySelector(`[data-comment-id="${commentId}"]`)
  if (pin) pin.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// ── Start ──────────────────────────────────────────────────────────────────────
init()
