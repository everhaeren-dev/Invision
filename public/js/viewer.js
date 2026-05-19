// ── State ─────────────────────────────────────────────────────────────────────
const projectId   = location.pathname.split('/').pop()
let project       = null
let pages         = []
let allComments   = {}   // pageId → [comments]
let currentPageId = null
let commentMode   = false
let pendingPin    = null
let activePinId   = null
let commentFilter = 'all'
let viewMode      = 'screens'   // 'screens' | 'viewer'
let dragCounter   = 0

// ── DOM refs ──────────────────────────────────────────────────────────────────
const projectName  = document.getElementById('projectName')
const pageSelect   = document.getElementById('pageSelect')
const canvasArea   = document.getElementById('canvasArea')
const canvasInner  = document.getElementById('canvasInner')
const canvasImg    = document.getElementById('canvasImg')
const retinaBadge  = document.getElementById('retinaBadge')
const sidebarScroll= document.getElementById('sidebarScroll')
const addCommentBtn= document.getElementById('addCommentBtn')
const commentBar   = document.getElementById('commentModeBar')
const dropOverlay  = document.getElementById('dropOverlay')
const shareToast   = document.getElementById('shareToast')
const shareUrlInput= document.getElementById('shareUrl')
const uploadProg   = document.getElementById('uploadProgress')
const progressFill = document.getElementById('progressFill')
const bottomBar    = document.getElementById('bottomBar')
const screensView  = document.getElementById('screensView')
const viewerBody   = document.getElementById('viewerBody')

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
function getAuthor() { return localStorage.getItem('iv_team_author') || 'Team' }

// ── Load data ─────────────────────────────────────────────────────────────────
async function init() {
  const [projRes, pagesRes] = await Promise.all([
    fetch(`/api/projects/${projectId}`).then(r => r.json()),
    fetch(`/api/projects/${projectId}/pages`).then(r => r.json())
  ])
  project = projRes
  pages = pagesRes
  projectName.textContent = project.name
  document.title = `${project.name} — InVision`
  await loadAllComments()
  showScreensView()
}

async function loadAllComments() {
  await Promise.all(pages.map(p =>
    fetch(`/api/pages/${p.id}/comments`).then(r => r.json()).then(c => { allComments[p.id] = c })
  ))
}

// ── View modes ────────────────────────────────────────────────────────────────
function showScreensView() {
  viewMode = 'screens'

  // Topbar
  document.getElementById('backToScreens').style.display = 'none'
  document.getElementById('divBack').style.display = 'none'
  document.getElementById('divSelect').style.display = 'none'
  pageSelect.style.display = 'none'
  document.getElementById('zoomSection').style.display = 'none'

  // Layout
  screensView.style.display = 'flex'
  viewerBody.style.display = 'none'
  bottomBar.style.display = 'none'
  addCommentBtn.style.display = 'none'
  cancelCommentMode()

  // Title
  document.getElementById('screensTitle').textContent = project.name
  const total = Object.values(allComments).reduce((s, c) => s + c.length, 0)
  document.getElementById('screensSubtitle').textContent =
    `${pages.length} page${pages.length !== 1 ? 's' : ''}${total ? ` · ${total} comment${total !== 1 ? 's' : ''}` : ''}`

  document.getElementById('noPagesScreens').classList.toggle('hidden', pages.length > 0)

  const grid = document.getElementById('screensGrid')
  grid.innerHTML = pages.map(p => {
    const count = (allComments[p.id] || []).length
    return `
      <div class="screen-card" data-pid="${p.id}">
        <div class="screen-thumb">
          <img src="/uploads/${project.id}/${p.filename}" alt="" draggable="false">
        </div>
        <div class="screen-info">
          <div class="screen-name">${esc(p.name)}${p.is_retina ? ' <span class="tag tag-client" style="font-size:10px;padding:1px 6px">@2x</span>' : ''}</div>
          <div class="screen-count">${count ? `${count} comment${count !== 1 ? 's' : ''}` : 'No comments'}</div>
        </div>
      </div>
    `
  }).join('')

  grid.querySelectorAll('.screen-card').forEach(card => {
    card.addEventListener('click', () => enterViewerMode(Number(card.dataset.pid)))
  })
}

function enterViewerMode(pageId) {
  viewMode = 'viewer'

  // Topbar
  document.getElementById('backToScreens').style.display = 'flex'
  document.getElementById('divBack').style.display = ''
  document.getElementById('divSelect').style.display = ''
  pageSelect.style.display = ''
  document.getElementById('zoomSection').style.display = 'flex'

  // Layout
  screensView.style.display = 'none'
  viewerBody.style.display = 'flex'
  addCommentBtn.style.display = 'flex'

  renderPageSelect()
  switchPage(pageId)
}

document.getElementById('backToScreens').addEventListener('click', () => {
  loadAllComments().then(() => showScreensView())
})

// ── Page management ───────────────────────────────────────────────────────────
function renderPageSelect() {
  pageSelect.innerHTML = pages.map(p =>
    `<option value="${p.id}">${esc(p.name)}${p.is_retina ? ' (@2x)' : ''}</option>`
  ).join('')
}

function renderBottomBar() {
  if (!pages.length || viewMode !== 'viewer') { bottomBar.style.display = 'none'; return }
  bottomBar.style.display = 'flex'
  bottomBar.innerHTML = pages.map(p => `
    <div class="strip-item${p.id === currentPageId ? ' active' : ''}" data-pid="${p.id}">
      <div class="strip-thumb">
        <img src="/uploads/${project.id}/${p.filename}" alt="" draggable="false">
      </div>
      <input class="strip-name" data-pid="${p.id}" value="${esc(p.name)}" title="Click to rename">
    </div>
  `).join('')

  bottomBar.querySelectorAll('.strip-item').forEach(item => {
    item.querySelector('.strip-thumb').addEventListener('click', () => switchPage(Number(item.dataset.pid)))
  })

  bottomBar.querySelectorAll('.strip-name').forEach(input => {
    input.addEventListener('focus', e => e.target.select())
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') e.target.blur()
      if (e.key === 'Escape') {
        const p = pages.find(p => p.id === Number(e.target.dataset.pid))
        if (p) e.target.value = p.name
        e.target.blur()
      }
      e.stopPropagation()
    })
    input.addEventListener('blur', async e => {
      const pid = Number(e.target.dataset.pid)
      const newName = e.target.value.trim()
      const p = pages.find(p => p.id === pid)
      if (!p || !newName || p.name === newName) {
        if (!newName) e.target.value = p?.name || ''
        return
      }
      p.name = newName
      await fetch(`/api/pages/${pid}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      })
      const opt = pageSelect.querySelector(`option[value="${pid}"]`)
      if (opt) opt.textContent = newName + (p.is_retina ? ' (@2x)' : '')
      renderSidebar()
    })
  })

  const activeItem = bottomBar.querySelector('.strip-item.active')
  if (activeItem) activeItem.scrollIntoView({ inline: 'nearest', behavior: 'smooth' })
}

function switchPage(pageId) {
  pageId = Number(pageId)
  currentPageId = pageId
  pageSelect.value = pageId
  activePinId = null
  cancelCommentMode()

  const page = pages.find(p => p.id === pageId)
  if (!page) return

  canvasInner.classList.remove('hidden')

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
  renderBottomBar()
}

pageSelect.addEventListener('change', () => switchPage(Number(pageSelect.value)))

// ── Zoom ──────────────────────────────────────────────────────────────────────
document.getElementById('zoomFit').addEventListener('click', () => {
  canvasArea.classList.add('fit-mode')
  document.getElementById('zoomFit').classList.add('active')
  document.getElementById('zoom100').classList.remove('active')
})
document.getElementById('zoom100').addEventListener('click', () => {
  canvasArea.classList.remove('fit-mode')
  document.getElementById('zoom100').classList.add('active')
  document.getElementById('zoomFit').classList.remove('active')
})

// ── Comment mode ──────────────────────────────────────────────────────────────
addCommentBtn.addEventListener('click', () => {
  if (commentMode) cancelCommentMode()
  else enterCommentMode()
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
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { cancelCommentMode(); closeAllBubbles() }
})

// ── Canvas click → place comment ──────────────────────────────────────────────
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

  // Pending pin sits in canvasInner
  const pp = document.createElement('div')
  pp.className = 'pending-pin'
  pp.style.left = x + '%'
  pp.style.top  = y + '%'
  canvasInner.appendChild(pp)
  pendingPin = pp

  showNewCommentForm(x, y)
})

function showNewCommentForm(x, y) {
  closeNewCommentForm()
  const author = getAuthor()
  const isBelow = y < 72

  // Form is a direct child of canvasInner (sibling of pin, not child)
  const form = document.createElement('div')
  form.className = 'new-comment-form'
  form.id = 'newCommentForm'
  form.style.left = Math.min(Math.max(x, 15), 75) + '%'
  form.style.position = 'absolute'

  if (isBelow) {
    form.style.top = `calc(${y}% + 20px)`
    form.style.transform = 'translateX(-50%)'
  } else {
    form.style.top = `calc(${y}% - 20px)`
    form.style.transform = 'translate(-50%, -100%)'
  }

  form.innerHTML = `
    <div class="nc-row">
      <input class="nc-input" id="ncAuthor" placeholder="Your name" value="${esc(author)}">
    </div>
    <textarea class="nc-textarea" id="ncText" placeholder="Leave a comment…" rows="3"></textarea>
    <div class="nc-actions">
      <div class="nc-type">
        <label><input type="radio" name="nc_type" value="team" checked> <span class="tag tag-team">Team</span></label>
        <label><input type="radio" name="nc_type" value="client"> <span class="tag tag-client">Client</span></label>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost" style="padding:5px 10px;font-size:12px" id="ncCancel">Cancel</button>
        <button class="btn btn-primary" style="padding:5px 10px;font-size:12px" id="ncSave">Post</button>
      </div>
    </div>
  `

  // Append to canvasInner directly, not inside pending-pin
  canvasInner.appendChild(form)
  form.querySelector('#ncText').focus()

  form.querySelector('#ncCancel').addEventListener('click', e => {
    e.stopPropagation(); cancelCommentMode()
  })
  form.querySelector('#ncSave').addEventListener('click', e => {
    e.stopPropagation(); submitComment(x, y, form)
  })
  form.querySelector('#ncText').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitComment(x, y, form)
    e.stopPropagation()
  })
  form.addEventListener('click', e => e.stopPropagation())
}

async function submitComment(x, y, form) {
  const author = form.querySelector('#ncAuthor').value.trim() || 'Team'
  const text   = form.querySelector('#ncText').value.trim()
  const isTeam = form.querySelector('input[name=nc_type]:checked').value === 'team'
  if (!text) { form.querySelector('#ncText').focus(); return }

  localStorage.setItem('iv_team_author', author)

  const res = await fetch(`/api/pages/${currentPageId}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y, text, author, is_team: isTeam })
  }).then(r => r.json())

  if (!allComments[currentPageId]) allComments[currentPageId] = []
  allComments[currentPageId].push(res)

  cancelCommentMode()
  renderPins()
  renderSidebar()
}

function closeNewCommentForm() {
  document.getElementById('newCommentForm')?.remove()
}

// ── Pins ──────────────────────────────────────────────────────────────────────
function renderPins() {
  canvasInner.querySelectorAll('.pin, .comment-bubble, .pending-pin').forEach(el => el.remove())
  if (!currentPageId) return

  filteredComments(currentPageId).forEach((c, idx) => {
    const pin = document.createElement('div')
    pin.className = `pin ${c.is_team ? 'team-pin' : 'client-pin'}${c.id === activePinId ? ' active' : ''}`
    pin.style.left = c.x + '%'
    pin.style.top  = c.y + '%'
    pin.textContent = idx + 1
    pin.dataset.commentId = c.id
    pin.addEventListener('click', e => {
      e.stopPropagation()
      if (commentMode) return
      if (activePinId === c.id) { activePinId = null; closeAllBubbles(); renderPins(); return }
      activePinId = c.id
      closeAllBubbles()
      renderPins()
    })
    canvasInner.appendChild(pin)
    if (c.id === activePinId) showBubble(c, idx + 1)
  })
}

function filteredComments(pageId) {
  const cs = allComments[pageId] || []
  if (commentFilter === 'team')   return cs.filter(c => c.is_team)
  if (commentFilter === 'client') return cs.filter(c => !c.is_team)
  return cs
}

// Bubble is appended to canvasInner (not the pin), positioned by percentage
function showBubble(comment, num) {
  const isBelow = comment.y < 72
  const bubble = document.createElement('div')
  bubble.className = 'comment-bubble'
  bubble.id = `bubble-${comment.id}`

  const clampedX = Math.min(Math.max(comment.x, 12), 82)
  bubble.style.left = clampedX + '%'
  bubble.style.position = 'absolute'
  bubble.style.zIndex = '20'

  if (isBelow) {
    bubble.style.top = `calc(${comment.y}% + 20px)`
    bubble.style.transform = 'translateX(-50%)'
  } else {
    bubble.style.top = `calc(${comment.y}% - 20px)`
    bubble.style.transform = 'translate(-50%, -100%)'
  }

  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="ci-pin ${comment.is_team ? 'team' : 'client'}" style="width:20px;height:20px;font-size:10px;flex-shrink:0">${num}</span>
      <span class="bubble-author">${esc(comment.author)}</span>
      <span class="tag ${comment.is_team ? 'tag-team' : 'tag-client'}">${comment.is_team ? 'Team' : 'Client'}</span>
      <span class="bubble-time">${relTime(comment.created_at)}</span>
    </div>
    <div class="bubble-text">${esc(comment.text)}</div>
    <button class="bubble-delete" data-id="${comment.id}">Delete</button>
  `
  bubble.querySelector('.bubble-delete').addEventListener('click', e => {
    e.stopPropagation(); deleteComment(comment.id)
  })
  bubble.addEventListener('click', e => e.stopPropagation())
  canvasInner.appendChild(bubble)
}

function closeAllBubbles() {
  canvasInner.querySelectorAll('.comment-bubble').forEach(el => el.remove())
}

canvasArea.addEventListener('click', e => {
  if (!commentMode && !e.target.closest('.pin') && !e.target.closest('.comment-bubble')) {
    activePinId = null
    closeAllBubbles()
    canvasInner.querySelectorAll('.pin').forEach(p => p.classList.remove('active'))
    sidebarScroll.querySelectorAll('.comment-item').forEach(i => i.classList.remove('highlighted'))
  }
})

async function deleteComment(id) {
  await fetch(`/api/comments/${id}`, { method: 'DELETE' })
  for (const pid of Object.keys(allComments)) {
    allComments[pid] = allComments[pid].filter(c => c.id !== id)
  }
  if (activePinId === id) activePinId = null
  renderPins()
  renderSidebar()
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebar() {
  if (!pages.length) {
    sidebarScroll.innerHTML = '<div class="sidebar-empty">Upload images to get started.</div>'
    return
  }

  const sections = pages.map(page => {
    const comments = filteredComments(page.id)
    if (!comments.length && commentFilter !== 'all') return ''
    const isOpen = page.id === currentPageId
    const listHtml = comments.map((c, idx) => `
      <div class="comment-item${c.id === activePinId ? ' highlighted' : ''}" data-cid="${c.id}" data-pid="${page.id}">
        <div class="ci-header">
          <div class="ci-pin ${c.is_team ? 'team' : 'client'}">${idx + 1}</div>
          <span class="ci-author">${esc(c.author)}</span>
          <span class="tag ${c.is_team ? 'tag-team' : 'tag-client'}" style="font-size:10px;padding:1px 6px">${c.is_team ? 'Team' : 'Client'}</span>
          <span class="ci-time">${relTime(c.created_at)}</span>
        </div>
        <div class="ci-text">${esc(c.text)}</div>
      </div>
    `).join('')

    return `
      <div class="page-section" data-pid="${page.id}">
        <div class="page-section-header">
          <span class="page-section-arrow ${isOpen ? 'open' : ''}">&#9654;</span>
          <span class="page-section-name">${esc(page.name)}</span>
          ${comments.length ? `<span class="page-section-badge">${comments.length}</span>` : ''}
        </div>
        <div class="page-comments" style="${isOpen ? '' : 'display:none'}">
          ${listHtml || '<div style="padding:6px 4px;font-size:12px;color:var(--text2)">No comments</div>'}
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
        setTimeout(() => highlightComment(cid), 350)
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
  sidebarScroll.querySelector(`[data-cid="${commentId}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  canvasInner.querySelector(`[data-comment-id="${commentId}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// ── Sidebar filter ────────────────────────────────────────────────────────────
document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    commentFilter = tab.dataset.filter
    renderPins()
    renderSidebar()
  })
})

// ── Upload ────────────────────────────────────────────────────────────────────
async function uploadFiles(files) {
  if (!files.length) return
  const fd = new FormData()
  for (const f of files) fd.append('images', f)

  uploadProg.classList.remove('hidden')
  progressFill.style.width = '30%'

  try {
    const res = await fetch(`/api/projects/${projectId}/pages`, {
      method: 'POST', body: fd
    }).then(r => r.json())

    progressFill.style.width = '100%'
    pages = res.pages
    for (const p of pages) { if (!allComments[p.id]) allComments[p.id] = [] }
    await loadAllComments()

    if (viewMode === 'screens') {
      showScreensView()
    } else {
      renderPageSelect()
      const newPage = res.pages[res.pages.length - res.uploaded.length]
      if (newPage) switchPage(newPage.id)
    }
  } finally {
    setTimeout(() => {
      uploadProg.classList.add('hidden')
      progressFill.style.width = '0%'
    }, 800)
  }
}

document.getElementById('fileInput').addEventListener('change', e => {
  uploadFiles([...e.target.files]); e.target.value = ''
})

// ── Drag & drop ───────────────────────────────────────────────────────────────
document.addEventListener('dragenter', e => {
  if ([...e.dataTransfer.types].includes('Files')) { dragCounter++; dropOverlay.classList.remove('hidden') }
})
document.addEventListener('dragleave', () => {
  dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.add('hidden') }
})
document.addEventListener('dragover', e => e.preventDefault())
document.addEventListener('drop', e => {
  e.preventDefault(); dragCounter = 0; dropOverlay.classList.add('hidden')
  uploadFiles([...e.dataTransfer.files].filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f.name)))
})

// ── Share ─────────────────────────────────────────────────────────────────────
document.getElementById('shareBtn').addEventListener('click', () => {
  if (!project) return
  shareUrlInput.value = `${location.origin}/share/${project.share_token}`
  shareToast.classList.remove('hidden')
})
document.getElementById('shareToastClose').addEventListener('click', () => shareToast.classList.add('hidden'))
document.getElementById('copyShareUrl').addEventListener('click', () => {
  shareUrlInput.select()
  navigator.clipboard.writeText(shareUrlInput.value).catch(() => document.execCommand('copy'))
  document.getElementById('copyShareUrl').textContent = 'Copied!'
  setTimeout(() => { document.getElementById('copyShareUrl').textContent = 'Copy' }, 2000)
})

// ── Start ─────────────────────────────────────────────────────────────────────
init()
