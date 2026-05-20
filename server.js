const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const session = require('express-session')
const sharp = require('sharp')
const db = require('./db')

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ─── Session ──────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'invision-secret-key-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}))

// ─── Protected HTML routes (must be before static middleware) ────────────────
app.get('/', (req, res) => {
  const users = db.getUsers()
  if (!users.length) return res.redirect('/register')
  if (!req.session || !req.session.userId) return res.redirect('/login')
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/project/:id', (req, res) => {
  if (!req.session || !req.session.userId) return res.redirect('/login')
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'))
})

// Block direct .html access for protected pages
app.get('/index.html', (req, res) => res.redirect('/'))
app.get('/viewer.html', (req, res) => res.redirect('/'))

// ─── Static files (CSS, JS, images — no auth required) ───────────────────────
app.use(express.static(path.join(__dirname, 'public')))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next()
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  res.redirect('/login')
}

// ─── Auth routes (public) ─────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/')
  res.sendFile(path.join(__dirname, 'public', 'login.html'))
})

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'))
})

app.get('/reset/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset.html'))
})

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.redirect('/login?error=missing')
  const user = db.getUserByEmail(email.trim().toLowerCase())
  if (!user) return res.redirect('/login?error=invalid')
  const ok = await bcrypt.compare(password, user.password_hash)
  if (!ok) return res.redirect('/login?error=invalid')
  req.session.userId = user.id
  req.session.userName = user.name
  res.redirect('/')
})

app.post('/auth/register', async (req, res) => {
  const { name, email, password } = req.body
  if (!name || !email || !password) return res.redirect('/register?error=missing')
  const existing = db.getUserByEmail(email.trim().toLowerCase())
  if (existing) return res.redirect('/register?error=exists')
  const hash = await bcrypt.hash(password, 10)
  db.createUser(email.trim().toLowerCase(), name.trim(), hash)
  res.redirect('/login?registered=1')
})

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'))
})

app.post('/auth/forgot', (req, res) => {
  const { email } = req.body
  const user = db.getUserByEmail((email || '').trim().toLowerCase())
  if (!user) return res.json({ ok: true, message: 'If that email exists, a reset link was generated.' })
  const token = crypto.randomBytes(20).toString('hex')
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  db.saveResetToken(user.id, token, expires)
  const link = `${req.protocol}://${req.get('host')}/reset/${token}`
  res.json({ ok: true, reset_link: link })
})

app.post('/auth/reset/:token', async (req, res) => {
  const { password } = req.body
  if (!password) return res.redirect(`/reset/${req.params.token}?error=missing`)
  const user = db.getUserByResetToken(req.params.token)
  if (!user) return res.redirect(`/reset/${req.params.token}?error=invalid`)
  if (new Date(user.reset_expires) < new Date()) {
    return res.redirect(`/reset/${req.params.token}?error=expired`)
  }
  const hash = await bcrypt.hash(password, 10)
  db.updatePassword(user.id, hash)
  res.redirect('/login?reset=1')
})

// ─── Share routes (public — no auth) ─────────────────────────────────────────
app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'))
})

app.get('/api/share/:token', (req, res) => {
  const project = db.getProjectByToken(req.params.token)
  if (!project) return res.status(404).json({ error: 'Not found' })
  const pages = db.getPages(project.id).map(p => ({
    ...p,
    comments: db.getComments(p.id, false).map(c => ({ ...c, replies: db.getReplies(c.id) }))
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

app.post('/api/share/:token/comments/:id/replies', (req, res) => {
  const project = db.getProjectByToken(req.params.token)
  if (!project) return res.status(404).json({ error: 'Not found' })
  const parent = db.getComment(req.params.id)
  if (!parent) return res.status(404).json({ error: 'Not found' })
  const page = db.getPage(parent.page_id)
  if (!page || page.project_id !== project.id) return res.status(403).json({ error: 'Forbidden' })
  const { text, author } = req.body
  if (!text || !author) return res.status(400).json({ error: 'text and author required' })
  const r = db.createComment(parent.page_id, null, null, text, author, false, parent.id, null)
  res.json({ id: r.lastInsertRowid, page_id: parent.page_id, parent_id: parent.id, text, author, is_team: 0, created_at: new Date().toISOString() })
})

app.get('/api/share/:token/clients', (req, res) => {
  const project = db.getProjectByToken(req.params.token)
  if (!project) return res.status(404).json({ error: 'Not found' })
  const pages = db.getPages(project.id)
  const names = new Set()
  for (const page of pages) {
    for (const c of db.getComments(page.id, false)) names.add(c.author)
  }
  res.json([...names])
})

// ─── Apply auth to all remaining API routes ───────────────────────────────────
app.use(requireAuth)

// Conflict check before upload
app.get('/api/projects/:projectId/pages/conflicts', (req, res) => {
  const project = db.getProject(req.params.projectId)
  if (!project) return res.status(404).json({ error: 'Not found' })
  const names = (req.query.names || '').split(',').filter(Boolean)
  const conflicts = names.map(filename => {
    const existing = db.getPageByOriginalFilename(project.id, filename)
    return existing ? { filename, existingName: existing.name } : null
  }).filter(Boolean)
  res.json(conflicts)
})

// Manual archive a page
app.put('/api/pages/:id/archive', (req, res) => {
  const page = db.getPage(req.params.id)
  if (!page) return res.status(404).json({ error: 'Not found' })
  db.archivePage(page.id)
  res.json({ ok: true })
})

// Unarchive (restore) a page
app.put('/api/pages/:id/unarchive', (req, res) => {
  const page = db.getPage(req.params.id)
  if (!page) return res.status(404).json({ error: 'Not found' })
  db.unarchivePage(page.id)
  res.json({ ok: true })
})

// ─── Multer storage ───────────────────────────────────────────────────────────
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
    const safe = base.replace(/[^a-zA-Z0-9À-ɏ@._-]/g, '_')
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

app.get('/api/projects/:id', (req, res) => {
  const project = db.getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'Not found' })
  res.json(project)
})

app.post('/api/projects', (req, res) => {
  const { name } = req.body
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' })
  const token = crypto.randomBytes(16).toString('hex')
  res.json(db.createProject(name.trim(), token))
})

app.put('/api/projects/:id', (req, res) => {
  const project = db.getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'Not found' })
  const { name } = req.body
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' })
  db.updateProjectName(project.id, name.trim())
  res.json({ ok: true })
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

app.post('/api/projects/:projectId/pages', upload.array('images'), async (req, res) => {
  const project = db.getProject(req.params.projectId)
  if (!project) return res.status(404).json({ error: 'Not found' })

  const existing = db.getPages(project.id)
  let order = existing.length

  const uploaded = []
  const archived = []

  for (const file of req.files) {
    const originalFilename = Buffer.from(file.originalname, 'latin1').toString('utf8')
    const isRetina = /@2x\./i.test(file.filename)
    const name = path.basename(originalFilename, path.extname(originalFilename))
      .replace(/@2x$/i, '')
      .replace(/[_-]/g, ' ')
      .trim()

    const existingPage = db.getPageByOriginalFilename(project.id, originalFilename)
    let version = 1
    if (existingPage) {
      version = (existingPage.version || 1) + 1
      db.archivePage(existingPage.id)
      archived.push({ id: existingPage.id, name: existingPage.name, version: existingPage.version || 1 })
    }

    db.createPage(project.id, name, file.filename, isRetina, order++, originalFilename, version)
    uploaded.push(file.filename)

    // Generate thumbnail + compress JPEG in-place
    const filePath = path.join(__dirname, 'uploads', String(project.id), file.filename)
    const base = path.basename(file.filename, path.extname(file.filename))
    const thumbPath = path.join(__dirname, 'uploads', String(project.id), `thumb_${base}.jpg`)
    const ext = path.extname(file.filename).toLowerCase()
    try {
      await sharp(filePath).resize(400).jpeg({ quality: 80 }).toFile(thumbPath)
      if (ext === '.jpg' || ext === '.jpeg') {
        const tmp = filePath + '.tmp'
        await sharp(filePath).jpeg({ quality: 85 }).toFile(tmp)
        fs.renameSync(tmp, filePath)
      }
    } catch (e) {
      console.error('Sharp error for', file.filename, e.message)
    }
  }

  res.json({ uploaded, pages: db.getPages(project.id), archived })
})

app.put('/api/pages/:id', (req, res) => {
  const page = db.getPage(req.params.id)
  if (!page) return res.status(404).json({ error: 'Not found' })
  const { name } = req.body
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' })
  db.updatePageName(page.id, name.trim())
  res.json({ ok: true })
})

app.delete('/api/pages/:id', (req, res) => {
  const page = db.getPage(req.params.id)
  if (!page) return res.status(404).json({ error: 'Not found' })

  const dir = path.join(__dirname, 'uploads', String(page.project_id))
  const filePath = path.join(dir, page.filename)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  const base = path.basename(page.filename, path.extname(page.filename))
  const thumbPath = path.join(dir, `thumb_${base}.jpg`)
  if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath)
  db.deletePage(page.id)
  res.json({ ok: true })
})

app.put('/api/projects/:projectId/pages/order', (req, res) => {
  const { pages } = req.body
  if (!Array.isArray(pages)) return res.status(400).json({ error: 'pages array required' })
  db.updatePageOrder(pages)
  res.json({ ok: true })
})

// ─── Archived pages ───────────────────────────────────────────────────────────
app.get('/api/projects/:projectId/archived', (req, res) => {
  const project = db.getProject(req.params.projectId)
  if (!project) return res.status(404).json({ error: 'Not found' })
  const archivedPages = db.getArchivedPages(project.id).map(p => ({
    ...p,
    comments: db.getComments(p.id)
  }))
  res.json(archivedPages)
})

// ─── Comments (team view) ─────────────────────────────────────────────────────
app.get('/api/pages/:pageId/comments', (req, res) => {
  const page = db.getPage(req.params.pageId)
  if (!page) return res.status(404).json({ error: 'Not found' })
  const comments = db.getComments(page.id).map(c => ({ ...c, replies: db.getReplies(c.id) }))
  res.json(comments)
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

// Reply to a comment
app.post('/api/comments/:id/replies', (req, res) => {
  const parent = db.getComment(req.params.id)
  if (!parent) return res.status(404).json({ error: 'Not found' })
  const { text, author, is_team } = req.body
  if (!text || !author) return res.status(400).json({ error: 'text and author required' })
  const r = db.createComment(parent.page_id, null, null, text, author, is_team, parent.id, null)
  res.json({ id: r.lastInsertRowid, page_id: parent.page_id, parent_id: parent.id, text, author, is_team: is_team ? 1 : 0, created_at: new Date().toISOString() })
})

// Move a pin
app.put('/api/comments/:id/position', (req, res) => {
  const c = db.getComment(req.params.id)
  if (!c) return res.status(404).json({ error: 'Not found' })
  const { x, y } = req.body
  if (x == null || y == null) return res.status(400).json({ error: 'x and y required' })
  db.updateCommentPosition(c.id, Number(x), Number(y))
  res.json({ ok: true })
})

// Resolve / reopen a comment
app.put('/api/comments/:id/resolve', (req, res) => {
  const c = db.getComment(req.params.id)
  if (!c) return res.status(404).json({ error: 'Not found' })
  db.resolveComment(c.id)
  res.json({ ok: true })
})

app.put('/api/comments/:id/reopen', (req, res) => {
  const c = db.getComment(req.params.id)
  if (!c) return res.status(404).json({ error: 'Not found' })
  db.reopenComment(c.id)
  res.json({ ok: true })
})

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`InVision running on http://localhost:${PORT}`))
