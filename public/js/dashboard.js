const grid = document.getElementById('projectsGrid')
const backdrop = document.getElementById('modalBackdrop')
const nameInput = document.getElementById('projectNameInput')

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

async function loadProjects() {
  const projects = await fetch('/api/projects').then(r => r.json())
  const newCard = document.getElementById('newProjectCard')
  grid.innerHTML = ''
  grid.appendChild(newCard)

  for (const p of projects) {
    const card = document.createElement('a')
    card.className = 'project-card'
    card.href = `/project/${p.id}`
    card.innerHTML = `
      <div class="project-thumb">
        ${p.first_page
          ? `<img src="/uploads/${p.id}/${p.first_page}" alt="">`
          : `<div class="no-thumb">&#128247;</div>`}
      </div>
      <div class="project-info">
        <div class="project-name">${escHtml(p.name)}</div>
        <div class="project-meta">
          <span>${p.page_count} page${p.page_count !== 1 ? 's' : ''}</span>
          <span>${timeAgo(p.created_at)}</span>
        </div>
      </div>
    `
    grid.insertBefore(card, newCard)
  }
}

function showModal() {
  backdrop.classList.remove('hidden')
  nameInput.value = ''
  nameInput.focus()
}
function hideModal() {
  backdrop.classList.add('hidden')
}

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

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

document.getElementById('newProjectBtn').addEventListener('click', showModal)
document.getElementById('newProjectCard').addEventListener('click', showModal)
document.getElementById('cancelBtn').addEventListener('click', hideModal)
document.getElementById('createBtn').addEventListener('click', createProject)
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') createProject() })
backdrop.addEventListener('click', e => { if (e.target === backdrop) hideModal() })

loadProjects()
