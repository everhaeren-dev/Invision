const fs = require('fs')
const path = require('path')

const DATA_FILE = path.join(__dirname, 'data', 'db.json')

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true })

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }
  catch { return { projects: [], pages: [], comments: [], seq: { projects: 0, pages: 0, comments: 0 } } }
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function nextId(data, table) {
  data.seq[table] = (data.seq[table] || 0) + 1
  return data.seq[table]
}

function now() { return new Date().toISOString() }

module.exports = {
  getProjects: () => {
    const db = load()
    return db.projects.slice().reverse().map(p => {
      const pages = db.pages.filter(pg => pg.project_id === p.id)
      const first = pages.sort((a,b) => a.sort_order - b.sort_order)[0]
      return { ...p, page_count: pages.length, first_page: first?.filename || null, first_page_id: first?.id || null }
    })
  },

  getProject: (id) => {
    const db = load()
    return db.projects.find(p => p.id === Number(id)) || null
  },

  getProjectByToken: (token) => {
    const db = load()
    return db.projects.find(p => p.share_token === token) || null
  },

  createProject: (name, token) => {
    const db = load()
    const p = { id: nextId(db, 'projects'), name, share_token: token, created_at: now() }
    db.projects.push(p)
    save(db)
    return p
  },

  deleteProject: (id) => {
    const db = load()
    id = Number(id)
    const pageIds = db.pages.filter(p => p.project_id === id).map(p => p.id)
    db.comments = db.comments.filter(c => !pageIds.includes(c.page_id))
    db.pages = db.pages.filter(p => p.project_id !== id)
    db.projects = db.projects.filter(p => p.id !== id)
    save(db)
  },

  getPages: (projectId) => {
    const db = load()
    return db.pages
      .filter(p => p.project_id === Number(projectId))
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  },

  getPage: (id) => {
    const db = load()
    return db.pages.find(p => p.id === Number(id)) || null
  },

  createPage: (projectId, name, filename, isRetina, order) => {
    const db = load()
    const p = { id: nextId(db, 'pages'), project_id: Number(projectId), name, filename, is_retina: isRetina ? 1 : 0, sort_order: order, created_at: now() }
    db.pages.push(p)
    save(db)
    return p
  },

  deletePage: (id) => {
    const db = load()
    id = Number(id)
    db.comments = db.comments.filter(c => c.page_id !== id)
    db.pages = db.pages.filter(p => p.id !== id)
    save(db)
  },

  updatePageName: (id, name) => {
    const db = load()
    const p = db.pages.find(p => p.id === Number(id))
    if (p) p.name = name
    save(db)
  },

  updatePageOrder: (pages) => {
    const db = load()
    for (const { id, order } of pages) {
      const p = db.pages.find(p => p.id === Number(id))
      if (p) p.sort_order = order
    }
    save(db)
  },

  getComments: (pageId, teamOnly = null) => {
    const db = load()
    let cs = db.comments.filter(c => c.page_id === Number(pageId))
    if (teamOnly === false) cs = cs.filter(c => !c.is_team)
    else if (teamOnly === true) cs = cs.filter(c => c.is_team)
    return cs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  },

  createComment: (pageId, x, y, text, author, isTeam) => {
    const db = load()
    const c = { id: nextId(db, 'comments'), page_id: Number(pageId), x, y, text, author, is_team: isTeam ? 1 : 0, created_at: now() }
    db.comments.push(c)
    save(db)
    return { lastInsertRowid: c.id }
  },

  deleteComment: (id) => {
    const db = load()
    db.comments = db.comments.filter(c => c.id !== Number(id))
    save(db)
  },

  getComment: (id) => {
    const db = load()
    return db.comments.find(c => c.id === Number(id)) || null
  },
}
