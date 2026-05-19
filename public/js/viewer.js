// ── State ───────────────────────────────────────────────────────────────────
const projectId = location.pathname.split('/').pop()
let project = null
let pages = []
let allComments = {}   // pageId → [comments]
let currentPageId = null
let commentMode = false
let pendingPin = null
let activePinId = null
let commentFilter = 'all'
let fitMode = false
let dragCounter = 0

// ── DOM refs ────────────────────────────────────────────────────────────────
const projectName  = document.getElementById('projectName')
const pageSelect   = document.getElementById('pageSelect')
const canvasArea   = document.getElementById('canvasArea')
const canvasInner  = document.getElementById('canvasInner')
const canvasImg    = document.getElementById('canvasImg')
const retinaBadge  = document.getElementById('retinaBadge')
const noPages      = document.getElementById('noPages')
const sidebarScroll= document.getElementById('sidebarScroll')
const sidebarEmpty = document.getElementById('sidebarEmpty')
const addCommentBtn= document.getElementById('addCommentBtn')
const commentBar   = document.getElementById('commentModeBar')
const dropOverlay  = document.getElementById('dropOverlay')
const shareToast   = document.getElementById('shareToast')
const shareUrlInput= document.getElementById('shareUrl')
const uploadProg   = document.getElementById('uploadProgress')
const progressFill = document.getElementById('progressFill')
const pagesCount   = document.getElementById('pagesCount')

// ── Helpers ─────────────────────────────────────────────────────────────────
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

// ── Load data ────────────────────────────────────────────────────────────────
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
  renderPageSelect()
  if (pages.length > 0) switchPage(pages[0].id)
  else showNoPages()
}

async function loadAllComments() {
  const fetches = pages.map(p =>
    fetch(`/api/pages/${p.id}/comments`).then(r => r.json()).then(c => { allComments[p.id] = c })
  )
  await Promise.all(fetches)
}

async function reloadComments(pageId) {
  allComments[pageId] = await fetch(`/api/pages/${pageId}/comments`).then(r => r.json())
}

// ── Page management ──────────────────────────────────────────────────────────
function renderPageSelect() {
  pageSelect.innerHTML = pages.map(p =>
    `<option value="${p.id}">${esc(p.name)}${p.is_retina ? ' (@2x)' : ''}</option>`
  ).join('')
  pagesCount.textContent = pages.length ? `${pages.length} page${pages.length > 1 ? 's' : ''}` : ''
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

function showNoPages() {
  noPages.classList.remove('hidden')
  canvasInner.classList.add('hidden')
  addCommentBtn.style.display = 'none'
  renderSidebar()
}

pageSelect.addEventListener('change', () => switchPage(Number(pageSelect.value)))

// ── Zoom ─────────────────────────────────────────────────────────────────────
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

// ── Comment mode ─────────────────────────────────────────────────────────────
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
document.addEventListener('keydown', e => { if (e.key === 'Escape') { cancelCommentMode(); closeAllBubbles() } })

// ── Canvas click → place comment ─────────────────────────────────────────────
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
  anchor.appendChild(form)

  const textarea = form.querySelector('#ncText')
  textarea.focus()

  form.querySelector('#ncCancel').addEventListener('click', e => {
    e.stopPropagation()
    cancelCommentMode()
  })
  form.querySelector('#ncSave').addEventListener('click', e => {
    e.stopPropagation()
    submitComment(x, y, form)
  })
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitComment(x, y, form)
    e.stopPropagation()
  })
  form.addEventListener('click', e => e.stopPropagation())
}

async function submitComment(x, y, form) {
  const authorEl = form.querySelector('#ncAuthor')
  const textEl   = form.querySelector('#ncText')
  const typeEl   = form.querySelector('input[name=nc_type]:checked')
  const author = authorEl.value.trim() || 'Team'
  const text   = textEl.value.trim()
  const isTeam = typeEl.value === 'team'
  if (!text) { textEl.focus(); return }

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
  highlightComment(res.id)
}

function closeNewCommentForm() {
  const f = document.getElementById('newCommentForm')
  if (f) f.remove()
}

// ── Pins ─────────────────────────────────────────────────────────────────────
function renderPins() {
  document.querySelectorAll('.pin, .comment-bubble, .pending-pin').forEach(el => el.remove())
  if (!currentPageId) return

  const comments = filteredComments(currentPageId)
  comments.forEach((c, idx) => {
    const pin = document.createElement('div')
    pin.className = `pin ${c.is_team ? 'team-pin' : 'client-pin'}${c.id === activePinId ? ' active' : ''}`
    pin.style.left = c.x + '%'
    pin.style.top  = c.y + '%'
    pin.textContent = idx + 1
    pin.dataset.commentId = c.id
    pin.addEventListener('click', e => {
      e.stopPropagation()
      toggleBubble(c, pin, idx + 1)
    })
    canvasInner.appendChild(pin)

    if (c.id === activePinId) showBubble(c, pin, idx + 1)
  })
}

function filteredComments(pageId) {
  const cs = allComments[pageId] || []
  if (commentFilter === 'team')   return cs.filter(c => c.is_team)
  if (commentFilter === 'client') return cs.filter(c => !c.is_team)
  return cs
}

function toggleBubble(comment, pin, num) {
  if (commentMode) return
  if (activePinId === comment.id) {
    activePinId = null
    closeAllBubbles()
    renderPins()
    return
  }
  activePinId = comment.id
  closeAllBubbles()
  renderPins()
}

function showBubble(comment, pin, num) {
  const rect = canvasImg.getBoundingClientRect()
  const pinY = comment.y / 100 * rect.height

  const bubble = document.createElement('div')
  bubble.className = 'comment-bubble'
  bubble.id = `bubble-${comment.id}`

  const isBelow = pinY < rect.height * 0.75
  bubble.classList.add(isBelow ? 'below' : 'above')
  bubble.style.left = Math.min(Math.max(comment.x, 15), 85) + '%'

  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="ci-pin ${comment.is_team ? 'team' : 'client'}" style="width:20px;height:20px;font-size:10px">${num}</span>
      <span class="bubble-author">${esc(comment.author)}</span>
      <span class="tag ${comment.is_team ? 'tag-team' : 'tag-client'}">${comment.is_team ? 'Team' : 'Client'}</span>
      <span class="bubble-time">${relTime(comment.created_at)}</span>
    </div>
    <div class="bubble-text">${esc(comment.text)}</div>
    <button class="bubble-delete" data-id="${comment.id}">Delete</button>
  `
  bubble.querySelector('.bubble-delete').addEventListener('click', e => {
    e.stopPropagation()
    deleteComment(comment.id)
  })
  bubble.addEventListener('click', e => e.stopPropagation())
  pin.appendChild(bubble)
}

function closeAllBubbles() {
  document.querySelectorAll('.comment-bubble').forEach(el => el.remove())
}

// close bubble on canvas bg click
canvasArea.addEventListener('click', e => {
  if (!commentMode && !e.target.closest('.pin') && !e.target.closest('.comment-bubble')) {
    activePinId = null
    closeAllBubbles()
    document.querySelectorAll('.pin').forEach(p => p.classList.remove('active'))
    document.querySelectorAll('.comment-item').forEach(i => i.classList.remove('highlighted'))
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
  const hasAnyComment = Object.values(allComments).some(cs => cs.length > 0)

  if (!pages.length) {
    sidebarEmpty.textContent = 'Upload images to get started.'
    sidebarEmpty.classList.remove('hidden')
    sidebarScroll.innerHTML = ''
    sidebarScroll.appendChild(sidebarEmpty)
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
          ${listHtml || '<div style="padding:6px 4px;font-size:12px;color:var(--text2)">No comments yet</div>'}
        </div>
      </div>
    `
  }).join('')

  sidebarScroll.innerHTML = sections

  // Click on page section header → toggle + switch page
  sidebarScroll.querySelectorAll('.page-section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.closest('.page-section')
      const pid = Number(section.dataset.pid)
      const comments = section.querySelector('.page-comments')
      const arrow = header.querySelector('.page-section-arrow')
      const isOpen = comments.style.display !== 'none'
      comments.style.display = isOpen ? 'none' : 'block'
      arrow.classList.toggle('open', !isOpen)
      if (!isOpen) switchPage(pid)
    })
  })

  // Click on comment item → navigate + highlight
  sidebarScroll.querySelectorAll('.comment-item').forEach(item => {
    item.addEventListener('click', () => {
      const cid = Number(item.dataset.cid)
      const pid = Number(item.dataset.pid)
      if (pid !== currentPageId) {
        switchPage(pid)
        // wait for image to load then highlight
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

  // Scroll sidebar item into view
  const item = sidebarScroll.querySelector(`[data-cid="${commentId}"]`)
  if (item) item.scrollIntoView({ behavior: 'smooth', block: 'nearest' })

  // Scroll canvas so the pin is visible
  const pin = canvasInner.querySelector(`[data-comment-id="${commentId}"]`)
  if (pin) {
    pin.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

// ── Sidebar filter tabs ───────────────────────────────────────────────────────
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
  const form = new FormData()
  for (const f of files) form.append('images', f)

  uploadProg.classList.remove('hidden')
  progressFill.style.width = '30%'

  try {
    const res = await fetch(`/api/projects/${projectId}/pages`, {
      method: 'POST', body: form
    }).then(r => r.json())

    progressFill.style.width = '100%'
    pages = res.pages

    // load comments for new pages
    for (const p of pages) {
      if (!allComments[p.id]) allComments[p.id] = []
    }
    await loadAllComments()

    renderPageSelect()
    pagesCount.textContent = `${pages.length} page${pages.length > 1 ? 's' : ''}`

    // switch to first new page
    const newPage = res.pages[res.pages.length - res.uploaded.length]
    if (newPage) switchPage(newPage.id)
  } finally {
    setTimeout(() => {
      uploadProg.classList.add('hidden')
      progressFill.style.width = '0%'
    }, 800)
  }
}

document.getElementById('fileInput').addEventListener('change', e => {
  uploadFiles([...e.target.files])
  e.target.value = ''
})
document.getElementById('fileInputEmpty').addEventListener('change', e => {
  uploadFiles([...e.target.files])
  e.target.value = ''
})

// ── Drag & drop ───────────────────────────────────────────────────────────────
document.addEventListener('dragenter', e => {
  if ([...e.dataTransfer.types].includes('Files')) {
    dragCounter++
    dropOverlay.classList.remove('hidden')
  }
})
document.addEventListener('dragleave', () => {
  dragCounter--
  if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.add('hidden') }
})
document.addEventListener('dragover', e => e.preventDefault())
document.addEventListener('drop', e => {
  e.preventDefault()
  dragCounter = 0
  dropOverlay.classList.add('hidden')
  const files = [...e.dataTransfer.files].filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f.name))
  uploadFiles(files)
})

// ── Share ─────────────────────────────────────────────────────────────────────
document.getElementById('shareBtn').addEventListener('click', () => {
  if (!project) return
  const url = `${location.origin}/share/${project.share_token}`
  shareUrlInput.value = url
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
