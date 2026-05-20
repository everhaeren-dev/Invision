const grid = document.getElementById('projectsGrid')
const backdrop = document.getElementById('modalBackdrop')
const nameInput = document.getElementById('projectNameInput')
let activeDropdown = null

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function closeDropdown() {
  if (activeDropdown) { activeDropdown.remove(); activeDropdown = null }
}

async function deleteProject(id, name) {
  if (!confirm(`Delete project "${name}"?\n\nThis will permanently remove all images and comments.`)) return
  await fetch(`/api/projects/${id}`, { method: 'DELETE' })
  loadProjects()
}

async function loadProjects() {
  const projects = await fetch('/api/projects').then(r => r.json())
  const newCard = document.getElementById('newProjectCard')
  grid.innerHTML = ''
  grid.appendChild(newCard)

  for (const p of projects) {
    const card = document.createElement('div')
    card.className = 'project-card'
    card.dataset.id = p.id
    card.innerHTML = `
      <div class="project-thumb">
        ${p.first_page
          ? `<img src="/uploads/${p.id}/thumb_${p.first_page.replace(/\.[^.]+$/, '')}.jpg" alt="" onerror="this.onerror=null;this.src='/uploads/${p.id}/${p.first_page}'">`
          : `<div class="no-thumb">&#128247;</div>`}
      </div>
      <div class="project-info">
        <div class="project-name">${escHtml(p.name)}</div>
        <div class="project-meta">
          <span>${p.page_count} page${p.page_count !== 1 ? 's' : ''}</span>
          <span>${timeAgo(p.created_at)}</span>
        </div>
      </div>
      <button class="card-menu-btn" title="Options">&#8942;</button>
    `

    // Click on card → open project (debounced on name area to allow dblclick rename)
    let _clickTimer = null
    card.addEventListener('click', e => {
      if (e.target.closest('.card-menu-btn') || e.target.closest('.card-dropdown') || e.target.tagName === 'INPUT') return
      if (e.target.closest('.project-name')) {
        if (_clickTimer) return
        _clickTimer = setTimeout(() => { _clickTimer = null; window.location.href = `/project/${p.id}` }, 220)
      } else {
        window.location.href = `/project/${p.id}`
      }
    })

    // Double-click on project name → rename inline
    card.querySelector('.project-name').addEventListener('dblclick', e => {
      if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null }
      const nameEl = card.querySelector('.project-name')
      const input = document.createElement('input')
      input.type = 'text'
      input.value = p.name
      input.style.cssText = 'width:100%;background:var(--bg3);border:1px solid var(--accent);border-radius:4px;color:var(--text);font-size:14px;font-weight:700;padding:2px 6px;outline:none;font-family:inherit;'
      nameEl.replaceWith(input)
      input.select()
      input.focus()
      const save = async () => {
        const newName = input.value.trim()
        if (newName && newName !== p.name) {
          p.name = newName
          await fetch(`/api/projects/${p.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
          })
        }
        loadProjects()
      }
      input.addEventListener('blur', save)
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur() }
        if (e.key === 'Escape') { input.value = p.name; input.blur() }
        e.stopPropagation()
      })
      input.addEventListener('click', e => e.stopPropagation())
    })

    // Menu button
    card.querySelector('.card-menu-btn').addEventListener('click', e => {
      e.stopPropagation()
      closeDropdown()

      const dropdown = document.createElement('div')
      dropdown.className = 'card-dropdown'
      dropdown.innerHTML = `
        <button class="danger" data-action="delete">&#128465; Delete project</button>
      `
      dropdown.querySelector('[data-action=delete]').addEventListener('click', e => {
        e.stopPropagation()
        closeDropdown()
        deleteProject(p.id, p.name)
      })
      card.appendChild(dropdown)
      activeDropdown = dropdown
    })

    grid.insertBefore(card, newCard)
  }
}

// Close dropdown on outside click
document.addEventListener('click', () => closeDropdown())

function showModal() {
  backdrop.classList.remove('hidden')
  nameInput.value = ''
  nameInput.focus()
}
function hideModal() { backdrop.classList.add('hidden') }

async function createProject() {
  const name = nameInput.value.trim()
  if (!name) { nameInput.focus(); return }
  const p = await fetch('/api/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  }).then(r => r.json())
  hideModal()
  window.location.href = `/project/${p.id}`
}

document.getElementById('newProjectBtn').addEventListener('click', showModal)
document.getElementById('newProjectCard').addEventListener('click', showModal)
document.getElementById('cancelBtn').addEventListener('click', hideModal)
document.getElementById('createBtn').addEventListener('click', createProject)
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') createProject() })
backdrop.addEventListener('click', e => { if (e.target === backdrop) hideModal() })

loadProjects()
