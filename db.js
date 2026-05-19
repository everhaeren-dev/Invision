const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true })

const db = new Database(path.join(__dirname, 'data', 'invision.db'))

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    share_token TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    is_retina INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    x REAL NOT NULL,
    y REAL NOT NULL,
    text TEXT NOT NULL,
    author TEXT NOT NULL,
    is_team INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

module.exports = {
  getProjects: () => db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM pages WHERE project_id = p.id) as page_count,
      (SELECT filename FROM pages WHERE project_id = p.id ORDER BY sort_order ASC LIMIT 1) as first_page,
      (SELECT id FROM pages WHERE project_id = p.id ORDER BY sort_order ASC LIMIT 1) as first_page_id
    FROM projects p ORDER BY p.created_at DESC
  `).all(),

  getProject: (id) => db.prepare(
    'SELECT * FROM projects WHERE id = ?'
  ).get(id),

  getProjectByToken: (token) => db.prepare(
    'SELECT * FROM projects WHERE share_token = ?'
  ).get(token),

  createProject: (name, token) => {
    const r = db.prepare('INSERT INTO projects (name, share_token) VALUES (?, ?)').run(name, token)
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(r.lastInsertRowid)
  },

  deleteProject: (id) => db.prepare('DELETE FROM projects WHERE id = ?').run(id),

  getPages: (projectId) => db.prepare(
    'SELECT * FROM pages WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(projectId),

  getPage: (id) => db.prepare('SELECT * FROM pages WHERE id = ?').get(id),

  createPage: (projectId, name, filename, isRetina, order) =>
    db.prepare(
      'INSERT INTO pages (project_id, name, filename, is_retina, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(projectId, name, filename, isRetina ? 1 : 0, order),

  deletePage: (id) => db.prepare('DELETE FROM pages WHERE id = ?').run(id),

  updatePageOrder: db.transaction((pages) => {
    const stmt = db.prepare('UPDATE pages SET sort_order = ? WHERE id = ?')
    for (const { id, order } of pages) stmt.run(order, id)
  }),

  getComments: (pageId, teamOnly = null) => {
    if (teamOnly === null) {
      return db.prepare('SELECT * FROM comments WHERE page_id = ? ORDER BY created_at ASC').all(pageId)
    }
    if (teamOnly === false) {
      return db.prepare('SELECT * FROM comments WHERE page_id = ? AND is_team = 0 ORDER BY created_at ASC').all(pageId)
    }
    return db.prepare('SELECT * FROM comments WHERE page_id = ? AND is_team = 1 ORDER BY created_at ASC').all(pageId)
  },

  createComment: (pageId, x, y, text, author, isTeam) =>
    db.prepare(
      'INSERT INTO comments (page_id, x, y, text, author, is_team) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(pageId, x, y, text, author, isTeam ? 1 : 0),

  deleteComment: (id) => db.prepare('DELETE FROM comments WHERE id = ?').run(id),

  getComment: (id) => db.prepare('SELECT * FROM comments WHERE id = ?').get(id),
}
