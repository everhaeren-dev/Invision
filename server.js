const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const db = require('./db')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads', String(req.params.projectId))
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8')
    const ext = path.extname(original)
    const base = path.basename(original, ext)
    const safe = base.replace(/[^a-zA-Z0-9@._-]/g, '_')
    const name = safe + ext
    cb(null, name)
  }
})

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    cb(null, /\.(jpg|jpeg|png|gif|webp)$/i.test(file.originalname))
  },
  limits: { fileSize: 50 * 1024 * 1024 }
})

// ─── Projects ─────────────────────────────────────────────────────────────────

app.get('/api/projects', (req, res) => {
  res.json(db.getProjects())
})

app.post('/api/projects', (req, res) => {
  const { name } = req.body
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' })
  const token = crypto.randomBytes(16).toString('hex')
  res.json(db.createProject(name.trim(), token))
})

app.delete('/api/projects/:id', (req, res) => {
  const project = db.getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'Not found' })

  const dir = path.join(__dirname, 'uploads', String(project.id))
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true })
  db.deleteProject(project.id)
  res.json({ ok: true })
})

// ─── Pages ────────────────────────────────────────────────────────────────────

app.get('/api/projects/:projectId/pages', (req, res) => {
  const project = db.getProject(req.params.projectId)
  if (!project) return res.status(404).json({ error: 'Not found' })
  res.json(db.getPages(project.id))
})

app.post('/api/projects/:projectId/pages', upload.array('images'), (req, res) => {
  const project = db.getProject(req.params.projectId)
  if (!project) return res.status(404).json({ error: 'Not found' })

  const existing = db.getPages(project.id)
  let order = existing.length

  const pages = []
  for (const file of req.files) {
    const isRetina = /@2x\./i.test(file.filename)
    const name = path.basename(file.filename, path.extname(file.filename))
      .replace(/@2x$/i, '')
      .replace(/[_-]/g, ' ')
    db.createPage(project.id, name, file.filename, isRetina, order++)
    pages.push(file.filename)
  }

  res.json({ uploaded: pages, pages: db.getPages(project.id) })
})

app.delete('/api/pages/:id', (req, res) => {
  const page = db.getPage(req.params.id)
  if (!page) return res.status(404).json({ error: 'Not found' })

  const filePath = path.join(__dirname, 'uploads', String(page.project_id), page.filename)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  db.deletePage(page.id)
  res.json({ ok: true })
})

app.put('/api/projects/:projectId/pages/order', (req, res) => {
  const { pages } = req.body
  if (!Array.isArray(pages)) return res.status(400).json({ error: 'pages array required' })
  db.updatePageOrder(pages)
  res.json({ ok: true })
})

// ─── Comments (team view) ─────────────────────────────────────────────────────

app.get('/api/pages/:pageId/comments', (req, res) => {
  const page = db.getPage(req.params.pageId)
  if (!page) return res.status(404).json({ error: 'Not found' })
  res.json(db.getComments(page.id))
})

app.post('/api/pages/:pageId/comments', (req, res) => {
  const page = db.getPage(req.params.pageId)
  if (!page) return res.status(404).json({ error: 'Not found' })
  const { x, y, text, author, is_team } = req.body
  if (!text || !author) return res.status(400).json({ error: 'text and author required' })
  const r = db.createComment(page.id, x, y, text, author, is_team)
  res.json({ id: r.lastInsertRowid, page_id: page.id, x, y, text, author, is_team, created_at: new Date().toISOString() })
})

app.delete('/api/comments/:id', (req, res) => {
  const comment = db.getComment(req.params.id)
  if (!comment) return res.status(404).json({ error: 'Not found' })
  db.deleteComment(comment.id)
  res.json({ ok: true })
})

// ─── Share (public client view) ───────────────────────────────────────────────

app.get('/api/share/:token', (req, res) => {
  const project = db.getProjectByToken(req.params.token)
  if (!project) return res.status(404).json({ error: 'Not found' })
  const pages = db.getPages(project.id).map(p => ({
    ...p,
    comments: db.getComments(p.id, false)
  }))
  res.json({ project, pages })
})

app.post('/api/share/:token/comments', (req, res) => {
  const project = db.getProjectByToken(req.params.token)
  if (!project) return res.status(404).json({ error: 'Not found' })
  const { page_id, x, y, text, author } = req.body
  const page = db.getPage(page_id)
  if (!page || page.project_id !== project.id) return res.status(403).json({ error: 'Forbidden' })
  if (!text || !author) return res.status(400).json({ error: 'text and author required' })
  const r = db.createComment(page.id, x, y, text, author, false)
  res.json({ id: r.lastInsertRowid, page_id: page.id, x, y, text, author, is_team: 0, created_at: new Date().toISOString() })
})

// ─── SPA routing ──────────────────────────────────────────────────────────────

app.get('/project/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'))
})

app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'))
})

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`InVision running on http://localhost:${PORT}`))
