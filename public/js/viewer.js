// ── State ─────────────────────────────────────────────────────────────────────
const projectId   = location.pathname.split('/').pop()
let project       = null
let pages         = []
let archivedPages = []
let allComments   = {}   // pageId → [comments]
let currentPageId = null
let commentMode   = false
let pendingPin    = null
let activePinId   = null
let commentFilter = 'all'   // 'all' | 'team' | 'client' | 'archive'
let viewMode      = 'screens'   // 'screens' | 'viewer'
let dragCounter   = 0
let archivedPageView = null  // pageId of archived page being viewed
let screensTab = 'screens'  // 'screens' | 'archives'

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
const uploadProg     = document.getElementById('uploadProgress')
const progressFill   = document.getElementById('progressFill')
const uploadTitle    = document.getElementById('uploadTitle')
const uploadPercent  = document.getElementById('uploadPercent')
const uploadFileList = document.getElementById('uploadFileList')
const bottomBar    = document.getElementById('bottomBar')
const screensView  = document.getElementById('screensView')
const viewerBody   = document.getElementById('viewerBody')

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
function thumbSrc(filename) {
  const base = filename.replace(/\.[^.]+$/, '')
  return `/uploads/${project.id}/thumb_${base}.jpg`
}
function thumbImg(filename, fallback) {
  return `<img src="${thumbSrc(filename)}" alt="" draggable="false" onerror="this.onerror=null;this.src='/uploads/${project.id}/${fallback || filename}'">`
}
function relTime(d) {
  const m = Math.floor((Date.now() - new Date(d)) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
function getAuthor() { return localStorage.getItem('iv_team_author') || 'Team' }
function markPageSeen(pageId) {
  localStorage.setItem('iv_seen_' + pageId, new Date().toISOString())
}
function getNewClientCommentCount(pageId) {
  const lastSeen = localStorage.getItem('iv_seen_' + pageId)
  const comments = allComments[pageId] || []
  if (!lastSeen) return comments.filter(c => !c.is_team).length
  return comments.filter(c => !c.is_team && new Date(c.created_at) > new Date(lastSeen)).length
}

// ── Load data ─────────────────────────────────────────────────────────────────
async function init() {
  const [projRes, pagesRes, archivedRes] = await Promise.all([
    fetch(`/api/projects/${projectId}`).then(r => r.json()),
    fetch(`/api/projects/${projectId}/pages`).then(r => r.json()),
    fetch(`/api/projects/${projectId}/archived`).then(r => r.json())
  ])
  project = projRes
  pages = pagesRes
  archivedPages = archivedRes
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

  document.getElementById('screensTitle').textContent = project.name

  // Tabs
  document.querySelectorAll('.screens-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === screensTab)
    tab.onclick = () => { screensTab = tab.dataset.tab; showScreensView() }
  })

  const grid = document.getElementById('screensGrid')

  if (screensTab === 'archives') {
    renderArchivesGrid(grid)
  } else {
    renderScreensGrid(grid)
  }
}

function renderScreensGrid(grid) {
  document.getElementById('noPagesScreens').classList.toggle('hidden', pages.length > 0)

  grid.innerHTML = pages.map(p => {
    const count = (allComments[p.id] || []).length
    const newCount = getNewClientCommentCount(p.id)
    return `
      <div class="screen-card" data-pid="${p.id}">
        <div class="screen-thumb" style="position:relative">
          <img src="/uploads/${project.id}/thumb_${p.filename.replace(/\.[^.]+$/, '')}.jpg" alt="" draggable="false" onerror="this.onerror=null;this.src='/uploads/${project.id}/${p.filename}'">
          ${newCount > 0 ? `<div class="notif-badge">${newCount}</div>` : ''}
        </div>
        <div class="screen-info">
          <div class="screen-name">${esc(p.name)}${p.is_retina ? ' <span class="tag tag-client" style="font-size:10px;padding:1px 6px">@2x</span>' : ''}</div>
          <div class="screen-count">${count ? `${count} comment${count !== 1 ? 's' : ''}` : 'No comments'}</div>
        </div>
        <div class="screen-menu">
          <button class="screen-menu-btn" title="Options">⋮</button>
          <div class="screen-dropdown hidden">
            <button data-action="archive">Archive</button>
            <button data-action="delete" class="danger">Delete</button>
          </div>
        </div>
      </div>
    `
  }).join('')

  // Close all dropdowns on outside click
  document.addEventListener('click', () => {
    grid.querySelectorAll('.screen-dropdown').forEach(d => d.classList.add('hidden'))
  }, { capture: false, once: false })

  grid.querySelectorAll('.screen-card').forEach(card => {
    const pid = Number(card.dataset.pid)
    let _clickTimer = null

    // ⋮ menu toggle
    const menuBtn = card.querySelector('.screen-menu-btn')
    const dropdown = card.querySelector('.screen-dropdown')
    menuBtn.addEventListener('click', e => {
      e.stopPropagation()
      const wasHidden = dropdown.classList.contains('hidden')
      grid.querySelectorAll('.screen-dropdown').forEach(d => d.classList.add('hidden'))
      if (wasHidden) dropdown.classList.remove('hidden')
    })

    // Archive action
    dropdown.querySelector('[data-action="archive"]').addEventListener('click', async e => {
      e.stopPropagation()
      dropdown.classList.add('hidden')
      const page = pages.find(p => p.id === pid)
      if (!page) return
      if (!confirm(`Archiver "${page.name}" ?\nLa page sera archivée avec tous ses commentaires.`)) return
      await fetch(`/api/pages/${pid}/archive`, { method: 'PUT' })
      pages = pages.filter(p => p.id !== pid)
      delete allComments[pid]
      archivedPages = await fetch(`/api/projects/${projectId}/archived`).then(r => r.json())
      showScreensView()
    })

    // Delete action
    dropdown.querySelector('[data-action="delete"]').addEventListener('click', async e => {
      e.stopPropagation()
      dropdown.classList.add('hidden')
      const page = pages.find(p => p.id === pid)
      if (!page) return
      if (!confirm(`Supprimer définitivement "${page.name}" ?\nL'image et tous ses commentaires seront supprimés.`)) return
      await fetch(`/api/pages/${pid}`, { method: 'DELETE' })
      pages = pages.filter(p => p.id !== pid)
      delete allComments[pid]
      showScreensView()
    })

    // Single click → navigate (debounced to allow dblclick)
    let _preventClick = false
    card.addEventListener('click', e => {
      if (e.target.closest('.screen-menu') || e.target.tagName === 'INPUT') return
      if (_preventClick) { _preventClick = false; return }
      if (_clickTimer) return
      _clickTimer = setTimeout(() => { _clickTimer = null; enterViewerMode(pid) }, 220)
    })

    // Double-click on name → rename
    card.addEventListener('dblclick', e => {
      if (!e.target.closest('.screen-info')) return
      if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null }
      startScreenRename(card, pid)
    })

    // Pointer-events drag to reorder (works on all browsers/proxies unlike HTML5 DnD)
    ;(() => {
      let startX, startY, dragging = false
      card.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.closest('.screen-menu') || e.target.tagName === 'INPUT') return
        startX = e.clientX; startY = e.clientY; dragging = false
        const onMove = e => {
          if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) > 6) {
            dragging = true; card.classList.add('dragging')
          }
          if (!dragging) return
          card.style.pointerEvents = 'none'
          const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.screen-card[data-pid]')
          card.style.pointerEvents = ''
          grid.querySelectorAll('.screen-card').forEach(c => c.classList.remove('drag-over'))
          if (over && over !== card) over.classList.add('drag-over')
        }
        const onUp = async () => {
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          card.classList.remove('dragging')
          if (!dragging) return
          dragging = false; _preventClick = true
          const target = grid.querySelector('.screen-card.drag-over')
          grid.querySelectorAll('.screen-card').forEach(c => c.classList.remove('drag-over'))
          if (!target) return
          const targetPid = Number(target.dataset.pid)
          if (targetPid === pid) return
          const di = pages.findIndex(p => p.id === pid)
          const ti = pages.findIndex(p => p.id === targetPid)
          if (di === -1 || ti === -1) return
          const [moved] = pages.splice(di, 1)
          pages.splice(ti, 0, moved)
          await fetch(`/api/projects/${projectId}/pages/order`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pages: pages.map((p, i) => ({ id: p.id, order: i })) })
          })
          showScreensView()
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
      })
    })()
    })
  })
}

function renderArchivesGrid(grid) {
  document.getElementById('noPagesScreens').classList.add('hidden')

  if (!archivedPages.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text2);padding:60px 0;font-size:14px">Aucune page archivée.</div>'
    return
  }

  grid.innerHTML = archivedPages.map(p => `
    <div class="screen-card archive-card" data-pid="${p.id}" style="opacity:.85">
      <div class="screen-thumb" style="position:relative">
        <img src="/uploads/${project.id}/thumb_${p.filename.replace(/\.[^.]+$/, '')}.jpg" alt="" draggable="false" onerror="this.onerror=null;this.src='/uploads/${project.id}/${p.filename}'">
        <div style="position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;pointer-events:none;">
          <span style="color:#bbb;font-size:10px;font-weight:800;letter-spacing:2px;background:rgba(0,0,0,.6);padding:4px 10px;border-radius:4px;">ARCHIVÉ</span>
        </div>
      </div>
      <div class="screen-info">
        <div class="screen-name">${esc(p.name)}</div>
        <div class="screen-count">v${p.version || 1} · archivée ${relTime(p.archived_at)}</div>
      </div>
      <div class="screen-menu">
        <button class="screen-menu-btn" title="Options">⋮</button>
        <div class="screen-dropdown hidden">
          <button data-action="unarchive">↩ Restaurer</button>
          <button data-action="delete" class="danger">Supprimer</button>
        </div>
      </div>
    </div>
  `).join('')

  grid.querySelectorAll('.archive-card').forEach(card => {
    const pid = Number(card.dataset.pid)

    card.addEventListener('click', e => {
      if (e.target.closest('.screen-menu')) return
      showArchivedPageViewer(pid)
    })

    const menuBtn = card.querySelector('.screen-menu-btn')
    const dropdown = card.querySelector('.screen-dropdown')
    menuBtn.addEventListener('click', e => {
      e.stopPropagation()
      const wasHidden = dropdown.classList.contains('hidden')
      grid.querySelectorAll('.screen-dropdown').forEach(d => d.classList.add('hidden'))
      if (wasHidden) dropdown.classList.remove('hidden')
    })

    dropdown.querySelector('[data-action="unarchive"]').addEventListener('click', async e => {
      e.stopPropagation()
      dropdown.classList.add('hidden')
      await fetch(`/api/pages/${pid}/unarchive`, { method: 'PUT' })
      const [pagesRes, archivedRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/pages`).then(r => r.json()),
        fetch(`/api/projects/${projectId}/archived`).then(r => r.json())
      ])
      pages = pagesRes
      archivedPages = archivedRes
      for (const p of pages) { if (!allComments[p.id]) allComments[p.id] = [] }
      await loadAllComments()
      screensTab = 'screens'
      showScreensView()
    })

    dropdown.querySelector('[data-action="delete"]').addEventListener('click', async e => {
      e.stopPropagation()
      dropdown.classList.add('hidden')
      const page = archivedPages.find(p => p.id === pid)
      if (!confirm(`Supprimer définitivement "${page?.name}" ?\nL'image et tous ses commentaires seront supprimés.`)) return
      await fetch(`/api/pages/${pid}`, { method: 'DELETE' })
      archivedPages = archivedPages.filter(p => p.id !== pid)
      showScreensView()
    })
  })
}

function startScreenRename(card, pid) {
  const nameEl = card.querySelector('.screen-name')
  const page = pages.find(p => p.id === pid)
  if (!page) return

  const input = document.createElement('input')
  input.type = 'text'
  input.value = page.name
  input.style.cssText = 'width:100%;background:var(--bg3);border:1px solid var(--accent);border-radius:4px;color:var(--text);font-size:13px;font-weight:600;padding:2px 6px;outline:none;font-family:inherit;'
  nameEl.replaceWith(input)
  input.select()
  input.focus()

  const save = async () => {
    const newName = input.value.trim()
    if (newName && newName !== page.name) {
      page.name = newName
      await fetch(`/api/pages/${pid}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      })
    }
    showScreensView()
  }
  input.addEventListener('blur', save)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur() }
    if (e.key === 'Escape') { input.value = page.name; input.blur() }
    e.stopPropagation()
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
  canvasInner.querySelectorAll('.archive-overlay').forEach(el => el.remove())
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
  bottomBar.innerHTML = pages.map(p => {
    const newCount = getNewClientCommentCount(p.id)
    return `
      <div class="strip-item${p.id === currentPageId ? ' active' : ''}" data-pid="${p.id}">
        <div class="strip-thumb" style="position:relative">
          <img src="/uploads/${project.id}/thumb_${p.filename.replace(/\.[^.]+$/, '')}.jpg" alt="" draggable="false" onerror="this.onerror=null;this.src='/uploads/${project.id}/${p.filename}'">
          ${newCount > 0 && p.id !== currentPageId ? `<div class="notif-badge" style="font-size:9px;min-width:14px;height:14px;top:3px;right:3px">${newCount}</div>` : ''}
        </div>
        <button class="strip-delete-btn" title="Delete page">&times;</button>
        <input class="strip-name" data-pid="${p.id}" value="${esc(p.name)}" title="Click to rename">
      </div>
    `
  }).join('')

  bottomBar.querySelectorAll('.strip-item').forEach(item => {
    item.querySelector('.strip-thumb').addEventListener('click', () => switchPage(Number(item.dataset.pid)))
    item.querySelector('.strip-delete-btn').addEventListener('click', async e => {
      e.stopPropagation()
      const pid = Number(item.dataset.pid)
      const page = pages.find(p => p.id === pid)
      if (!confirm(`Delete page "${page?.name}"?\nThis will remove the image and all its comments.`)) return
      await fetch(`/api/pages/${pid}`, { method: 'DELETE' })
      pages = pages.filter(p => p.id !== pid)
      delete allComments[pid]
      if (currentPageId === pid) {
        if (pages.length) switchPage(pages[0].id)
        else { showScreensView() }
      } else {
        renderBottomBar()
        renderPageSelect()
        renderSidebar()
      }
    })

    // Pointer-events drag to reorder
    ;(() => {
      let startX, startY, dragging = false
      item.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.tagName === 'INPUT') return
        startX = e.clientX; startY = e.clientY; dragging = false
        const onMove = e => {
          if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) > 6) {
            dragging = true; item.classList.add('dragging')
          }
          if (!dragging) return
          item.style.pointerEvents = 'none'
          const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.strip-item[data-pid]')
          item.style.pointerEvents = ''
          bottomBar.querySelectorAll('.strip-item').forEach(s => s.classList.remove('drag-over'))
          if (over && over !== item) over.classList.add('drag-over')
        }
        const onUp = async () => {
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          item.classList.remove('dragging')
          if (!dragging) return
          dragging = false
          const target = bottomBar.querySelector('.strip-item.drag-over')
          bottomBar.querySelectorAll('.strip-item').forEach(s => s.classList.remove('drag-over'))
          if (!target) return
          const targetPid = Number(target.dataset.pid)
          const thisPid = Number(item.dataset.pid)
          if (targetPid === thisPid) return
          const di = pages.findIndex(p => p.id === thisPid)
          const ti = pages.findIndex(p => p.id === targetPid)
          if (di === -1 || ti === -1) return
          const [moved] = pages.splice(di, 1)
          pages.splice(ti, 0, moved)
          renderBottomBar(); renderPageSelect()
          await fetch(`/api/projects/${projectId}/pages/order`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pages: pages.map((p, i) => ({ id: p.id, order: i })) })
          })
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
      })
    })()
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
  markPageSeen(pageId)
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

  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      viewMode === 'viewer' && !commentMode &&
      !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    const idx = pages.findIndex(p => p.id === currentPageId)
    if (idx === -1) return
    const next = e.key === 'ArrowRight' ? pages[idx + 1] : pages[idx - 1]
    if (next) switchPage(next.id)
  }
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
    pin.className = `pin ${c.is_team ? 'team-pin' : 'client-pin'}${c.id === activePinId ? ' active' : ''}${c.status === 'resolved' ? ' resolved-pin' : ''}`
    pin.style.left = c.x + '%'
    pin.style.top  = c.y + '%'
    pin.textContent = idx + 1
    pin.dataset.commentId = c.id
    let _pinDragged = false
    pin.addEventListener('mousedown', e => {
      if (commentMode) return
      e.stopPropagation()
      e.preventDefault()
      const startMouseX = e.clientX
      const startMouseY = e.clientY
      const startPinX = c.x
      const startPinY = c.y
      _pinDragged = false

      const onMove = e => {
        const rect = canvasImg.getBoundingClientRect()
        const dx = e.clientX - startMouseX
        const dy = e.clientY - startMouseY
        if (!_pinDragged && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
          _pinDragged = true
          pin.classList.add('pin-dragging')
          closeAllBubbles()
          activePinId = null
        }
        if (!_pinDragged) return
        const newX = Math.max(0, Math.min(100, startPinX + dx / rect.width * 100))
        const newY = Math.max(0, Math.min(100, startPinY + dy / rect.height * 100))
        pin.style.left = newX + '%'
        pin.style.top  = newY + '%'
      }

      const onUp = async () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        if (!_pinDragged) return
        pin.classList.remove('pin-dragging')
        const newX = parseFloat(pin.style.left)
        const newY = parseFloat(pin.style.top)
        c.x = newX
        c.y = newY
        await fetch(`/api/comments/${c.id}/position`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x: newX, y: newY })
        })
        renderPins()
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })

    pin.addEventListener('click', e => {
      e.stopPropagation()
      if (_pinDragged) return
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
  if (commentFilter === 'team')     return cs.filter(c => c.is_team)
  if (commentFilter === 'client')   return cs.filter(c => !c.is_team)
  if (commentFilter === 'resolved') return cs.filter(c => c.status === 'resolved')
  return cs  // 'all': includes open AND resolved
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

  const replies = comment.replies || []
  const repliesHtml = replies.map(r => `
    <div class="reply-item">
      <div class="reply-header">
        <span class="ci-author">${esc(r.author)}</span>
        <span class="tag ${r.is_team ? 'tag-team' : 'tag-client'}" style="font-size:10px;padding:1px 6px">${r.is_team ? 'Team' : 'Client'}</span>
        <span class="bubble-time">${relTime(r.created_at)}</span>
      </div>
      <div class="reply-text">${esc(r.text)}</div>
    </div>
  `).join('')

  const isResolved = comment.status === 'resolved'

  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="ci-pin ${comment.is_team ? 'team' : 'client'}" style="width:20px;height:20px;font-size:10px;flex-shrink:0">${num}</span>
      <span class="bubble-author">${esc(comment.author)}</span>
      <span class="tag ${comment.is_team ? 'tag-team' : 'tag-client'}">${comment.is_team ? 'Team' : 'Client'}</span>
      <span class="bubble-time">${relTime(comment.created_at)}</span>
      ${isResolved ? '<span class="resolved-badge">✓ Résolu</span>' : ''}
    </div>
    <div class="bubble-text${isResolved ? ' resolved-text' : ''}">${esc(comment.text)}</div>
    ${replies.length ? `<div class="replies-thread">${repliesHtml}</div>` : ''}
    <div class="reply-form">
      <textarea class="nc-textarea reply-textarea" placeholder="Répondre…" rows="2" id="replyText-${comment.id}"></textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
        <div style="display:flex;gap:6px">
          <button class="btn btn-primary" style="padding:4px 10px;font-size:12px" id="replySend-${comment.id}">Répondre</button>
          <button class="bubble-delete" data-id="${comment.id}">Supprimer</button>
        </div>
        <button class="resolve-btn" data-id="${comment.id}" data-resolved="${isResolved ? '1' : '0'}">
          ${isResolved ? '↩ Rouvrir' : '✓ Résoudre'}
        </button>
      </div>
    </div>
  `

  bubble.querySelector('.bubble-delete').addEventListener('click', e => {
    e.stopPropagation(); deleteComment(comment.id)
  })
  bubble.querySelector('.resolve-btn').addEventListener('click', async e => {
    e.stopPropagation()
    const resolved = e.currentTarget.dataset.resolved === '1'
    if (resolved) {
      await fetch(`/api/comments/${comment.id}/reopen`, { method: 'PUT' })
      comment.status = 'open'
    } else {
      await fetch(`/api/comments/${comment.id}/resolve`, { method: 'PUT' })
      comment.status = 'resolved'
    }
    renderPins()
    renderSidebar()
  })
  const replyTextarea = bubble.querySelector(`#replyText-${comment.id}`)
  bubble.querySelector(`#replySend-${comment.id}`).addEventListener('click', async e => {
    e.stopPropagation()
    const text = replyTextarea.value.trim()
    if (!text) { replyTextarea.focus(); return }
    const author = getAuthor()
    const res = await fetch(`/api/comments/${comment.id}/replies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, author, is_team: true })
    }).then(r => r.json())
    if (!comment.replies) comment.replies = []
    comment.replies.push(res)
    replyTextarea.value = ''
    renderPins()
    renderSidebar()
  })
  replyTextarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) bubble.querySelector(`#replySend-${comment.id}`).click()
    e.stopPropagation()
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
    const listHtml = filteredComments(page.id).map((c, idx) => {
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
            <div class="ci-pin ${c.is_team ? 'team' : 'client'}">${idx + 1}</div>
            <span class="ci-author">${esc(c.author)}</span>
            <span class="tag ${c.is_team ? 'tag-team' : 'tag-client'}" style="font-size:10px;padding:1px 6px">${c.is_team ? 'Team' : 'Client'}</span>
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
async function showArchiveConfirm(conflicts) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1000;display:flex;align-items:center;justify-content:center;'
    const box = document.createElement('div')
    box.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:28px 32px;max-width:440px;width:90%;'
    box.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:17px;font-weight:700">Fichier${conflicts.length > 1 ? 's' : ''} déjà existant${conflicts.length > 1 ? 's' : ''}</h3>
      <p style="color:var(--text2);font-size:13px;margin:0 0 14px">La version actuelle sera archivée (commentaires conservés) avant remplacement :</p>
      <ul style="margin:0 0 22px;padding:0 0 0 18px;font-size:13px;line-height:2.2">
        ${conflicts.map(c => `<li><strong>${esc(c.filename)}</strong> remplace <em>"${esc(c.existingName)}"</em></li>`).join('')}
      </ul>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-ghost" id="_cfCancel">Annuler</button>
        <button class="btn btn-primary" id="_cfOk">Archiver &amp; remplacer</button>
      </div>
    `
    overlay.appendChild(box)
    document.body.appendChild(overlay)
    overlay.querySelector('#_cfCancel').onclick = () => { overlay.remove(); resolve(false) }
    overlay.querySelector('#_cfOk').onclick = () => { overlay.remove(); resolve(true) }
  })
}

async function uploadFiles(files) {
  if (!files.length) return

  // Conflict check upfront for all files at once
  try {
    const names = files.map(f => f.name).join(',')
    const conflicts = await fetch(`/api/projects/${projectId}/pages/conflicts?names=${encodeURIComponent(names)}`).then(r => r.json())
    if (conflicts.length > 0) {
      const confirmed = await showArchiveConfirm(conflicts)
      if (!confirmed) return
    }
  } catch (e) { /* proceed if check fails */ }

  // Build panel
  uploadTitle.textContent = `${files.length} fichier${files.length > 1 ? 's' : ''} en cours d'upload`
  uploadPercent.textContent = '0%'
  uploadFileList.innerHTML = files.map((f, i) => `
    <div class="upload-file-item" data-idx="${i}">
      <span class="ufi-icon">⏳</span>
      <span class="ufi-name">${esc(f.name)}</span>
    </div>
  `).join('')
  progressFill.style.width = '0%'
  uploadProg.classList.remove('hidden')

  const originalPageIds = new Set(pages.map(p => p.id))
  let lastRes = null

  // Upload one file at a time so each gets a checkmark when done + real XHR progress
  for (let i = 0; i < files.length; i++) {
    const item = uploadFileList.querySelector(`[data-idx="${i}"]`)
    item.querySelector('.ufi-icon').textContent = '↑'
    item.classList.add('uploading')

    try {
      lastRes = await uploadSingleFile(files[i], pct => {
        const overall = Math.round((i + pct / 100) / files.length * 100)
        progressFill.style.width = overall + '%'
        uploadPercent.textContent = overall + '%'
      })
      item.querySelector('.ufi-icon').textContent = '✓'
      item.classList.replace('uploading', 'done')
    } catch (e) {
      item.querySelector('.ufi-icon').textContent = '✗'
      item.classList.replace('uploading', 'error')
    }
  }

  progressFill.style.width = '100%'
  uploadPercent.textContent = '100%'

  if (lastRes) {
    pages = lastRes.pages
    for (const p of pages) { if (!allComments[p.id]) allComments[p.id] = [] }
    await loadAllComments()
    archivedPages = await fetch(`/api/projects/${projectId}/archived`).then(r => r.json())

    if (viewMode === 'screens') {
      showScreensView()
    } else {
      renderPageSelect()
      const firstNew = pages.find(p => !originalPageIds.has(p.id))
      if (firstNew) switchPage(firstNew.id)
    }
  }

  setTimeout(() => { uploadProg.classList.add('hidden'); progressFill.style.width = '0%' }, 1500)
}

function uploadSingleFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append('images', file)
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.min(90, Math.round(e.loaded / e.total * 90)))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100)
        try { resolve(JSON.parse(xhr.responseText)) } catch (e) { reject(new Error('Invalid response')) }
      } else {
        reject(new Error(`HTTP ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.open('POST', `/api/projects/${projectId}/pages`)
    xhr.send(fd)
  })
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

// ── Toast helper ──────────────────────────────────────────────────────────────
function showToastMessage(msg) {
  const existing = document.getElementById('genericToast')
  if (existing) existing.remove()
  const t = document.createElement('div')
  t.id = 'genericToast'
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 18px;font-size:13px;color:var(--text);z-index:200;box-shadow:0 4px 20px #0008;white-space:nowrap;'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 4000)
}

// ── Archive view ───────────────────────────────────────────────────────────────
function showArchivedPageViewer(pageId) {
  const page = archivedPages.find(p => p.id === pageId)
  if (!page) return

  screensView.style.display = 'none'
  viewerBody.style.display = 'flex'
  addCommentBtn.style.display = 'none'
  bottomBar.style.display = 'none'
  document.getElementById('backToScreens').style.display = 'flex'
  document.getElementById('divBack').style.display = ''
  document.getElementById('divSelect').style.display = 'none'
  pageSelect.style.display = 'none'
  document.getElementById('zoomSection').style.display = 'none'

  canvasInner.classList.remove('hidden')
  canvasInner.querySelectorAll('.pin, .comment-bubble, .pending-pin, .archive-overlay').forEach(el => el.remove())
  retinaBadge.classList.add('hidden')

  canvasImg.src = `/uploads/${project.id}/${page.filename}`
  canvasImg.onload = () => {
    if (page.is_retina) {
      canvasImg.style.width  = (canvasImg.naturalWidth  / 2) + 'px'
      canvasImg.style.height = (canvasImg.naturalHeight / 2) + 'px'
    } else {
      canvasImg.style.width  = ''
      canvasImg.style.height = ''
    }
    const overlay = document.createElement('div')
    overlay.className = 'archive-overlay'
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:10;'
    overlay.innerHTML = '<div style="background:rgba(0,0,0,0.7);color:#aaa;font-size:24px;font-weight:800;letter-spacing:4px;padding:12px 32px;border-radius:8px;border:2px solid #555;">ARCHIVÉ</div>'
    canvasInner.appendChild(overlay)

    // Read-only pins above the dim overlay
    ;(page.comments || []).filter(c => c.x != null && c.y != null).forEach((c, idx) => {
      const pin = document.createElement('div')
      pin.className = `pin ${c.is_team ? 'team-pin' : 'client-pin'}`
      pin.style.left = c.x + '%'
      pin.style.top  = c.y + '%'
      pin.style.zIndex = '15'
      pin.style.cursor = 'default'
      pin.style.transition = 'none'
      pin.textContent = idx + 1
      pin.title = `${c.author} : ${c.text}`
      canvasInner.appendChild(pin)
    })
  }

  const comments = page.comments || []
  sidebarScroll.innerHTML = `
    <div style="padding:10px 16px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);background:var(--bg3)">
      <strong>${esc(page.name)}</strong> — version ${page.version || 1} (archivée)
    </div>
  ` + (comments.length ? comments.map((c, i) => `
    <div class="comment-item">
      <div class="ci-header">
        <div class="ci-pin ${c.is_team ? 'team' : 'client'}">${i + 1}</div>
        <span class="ci-author">${esc(c.author)}</span>
        <span class="tag ${c.is_team ? 'tag-team' : 'tag-client'}" style="font-size:10px;padding:1px 6px">${c.is_team ? 'Team' : 'Client'}</span>
      </div>
      <div class="ci-text">${esc(c.text)}</div>
    </div>
  `).join('') : '<div class="sidebar-empty">Pas de commentaires.</div>')
}

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
