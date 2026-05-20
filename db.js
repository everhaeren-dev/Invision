const fs = require('fs')
const path = require('path')

const DATA_FILE = path.join(__dirname, 'data', 'db.json')

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true })

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }
  catch {
    return {
      projects: [],
      pages: [],
      comments: [],
      users: [],
      seq: { projects: 0, pages: 0, comments: 0, users: 0 }
    }
  }
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
  // ── Projects ──────────────────────────────────────────────────────────────
  getProjects: () => {
    const db = load()
    return db.projects.slice().reverse().map(p => {
      const pages = db.pages.filter(pg => pg.project_id === p.id && !pg.is_archived)
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

  updateProjectName: (id, name) => {
    const db = load()
    const p = db.projects.find(p => p.id === Number(id))
    if (p) p.name = name
    save(db)
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

  // ── Pages ─────────────────────────────────────────────────────────────────
  getPages: (projectId) => {
    const db = load()
    return db.pages
      .filter(p => p.project_id === Number(projectId) && !p.is_archived)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  },

  getPage: (id) => {
    const db = load()
    return db.pages.find(p => p.id === Number(id)) || null
  },

  createPage: (projectId, name, filename, isRetina, order, originalFilename, version) => {
    const db = load()
    const p = {
      id: nextId(db, 'pages'),
      project_id: Number(projectId),
      name,
      filename,
      is_retina: isRetina ? 1 : 0,
      sort_order: order,
      is_archived: 0,
      archived_at: null,
      original_filename: originalFilename || filename,
      version: version || 1,
      created_at: now()
    }
    db.pages.push(p)
    save(db)
    return p
  },

  archivePage: (id) => {
    const db = load()
    const p = db.pages.find(p => p.id === Number(id))
    if (p) {
      p.is_archived = 1
      p.archived_at = now()
    }
    save(db)
  },

  getPageByOriginalFilename: (projectId, originalFilename) => {
    const db = load()
    const ext = path.extname(originalFilename)
    const base = path.basename(originalFilename, ext)
    const sanitized = base.replace(/[^a-zA-Z0-9@._-]/g, '_') + ext
    return db.pages.find(
      p => p.project_id === Number(projectId) &&
           !p.is_archived &&
           (p.original_filename === originalFilename ||
            (!p.original_filename && p.filename === sanitized))
    ) || null
  },

  getArchivedPages: (projectId) => {
    const db = load()
    return db.pages
      .filter(p => p.project_id === Number(projectId) && p.is_archived)
      .sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at))
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

  // ── Comments ──────────────────────────────────────────────────────────────
  getComments: (pageId, teamOnly = null) => {
    const db = load()
    let cs = db.comments.filter(c => c.page_id === Number(pageId) && !c.parent_id)
    if (teamOnly === false) cs = cs.filter(c => !c.is_team)
    else if (teamOnly === true) cs = cs.filter(c => c.is_team)
    return cs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  },

  getReplies: (commentId) => {
    const db = load()
    return db.comments
      .filter(c => c.parent_id === Number(commentId))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  },

  resolveComment: (id) => {
    const db = load()
    const c = db.comments.find(c => c.id === Number(id))
    if (c) c.status = 'resolved'
    save(db)
  },

  reopenComment: (id) => {
    const db = load()
    const c = db.comments.find(c => c.id === Number(id))
    if (c) c.status = 'open'
    save(db)
  },

  updateCommentPosition: (id, x, y) => {
    const db = load()
    const c = db.comments.find(c => c.id === Number(id))
    if (c) { c.x = x; c.y = y }
    save(db)
  },

  createComment: (pageId, x, y, text, author, isTeam, parentId = null, status = 'open') => {
    const db = load()
    const c = { id: nextId(db, 'comments'), page_id: Number(pageId), x, y, text, author, is_team: isTeam ? 1 : 0, parent_id: parentId, status: parentId ? null : status, created_at: now() }
    db.comments.push(c)
    save(db)
    return { lastInsertRowid: c.id }
  },

  deleteComment: (id) => {
    const db = load()
    id = Number(id)
    db.comments = db.comments.filter(c => c.id !== id && c.parent_id !== id)
    save(db)
  },

  getComment: (id) => {
    const db = load()
    return db.comments.find(c => c.id === Number(id)) || null
  },

  // ── Users ─────────────────────────────────────────────────────────────────
  getUsers: () => {
    const db = load()
    return db.users || []
  },

  getUserByEmail: (email) => {
    const db = load()
    return (db.users || []).find(u => u.email === email) || null
  },

  getUserById: (id) => {
    const db = load()
    return (db.users || []).find(u => u.id === Number(id)) || null
  },

  createUser: (email, name, passwordHash) => {
    const db = load()
    if (!db.users) db.users = []
    if (!db.seq) db.seq = {}
    const u = {
      id: nextId(db, 'users'),
      email,
      name,
      password_hash: passwordHash,
      reset_token: null,
      reset_expires: null,
      created_at: now()
    }
    db.users.push(u)
    save(db)
    return u
  },

  updatePassword: (id, hash) => {
    const db = load()
    const u = (db.users || []).find(u => u.id === Number(id))
    if (u) {
      u.password_hash = hash
      u.reset_token = null
      u.reset_expires = null
    }
    save(db)
  },

  saveResetToken: (id, token, expires) => {
    const db = load()
    const u = (db.users || []).find(u => u.id === Number(id))
    if (u) {
      u.reset_token = token
      u.reset_expires = expires
    }
    save(db)
  },

  getUserByResetToken: (token) => {
    const db = load()
    return (db.users || []).find(u => u.reset_token === token) || null
  },
}
