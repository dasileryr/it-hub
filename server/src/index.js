import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const { Pool } = pg
const port = Number(process.env.PORT || 3000)
const uploadDir = process.env.UPLOAD_DIR || '/app/uploads'
const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
const jwtSecret = process.env.JWT_SECRET
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean)
if (!process.env.DATABASE_URL || !jwtSecret || !publicUrl) throw new Error('DATABASE_URL, JWT_SECRET and PUBLIC_URL are required')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
await fs.mkdir(uploadDir, { recursive: true })

async function migrate() {
  await pool.query(`
    create extension if not exists pgcrypto;
    create table if not exists profiles (
      id uuid primary key default gen_random_uuid(), username text not null unique,
      password_hash text not null, full_name text not null default '',
      role text not null default 'executor' check (role in ('admin','boss','executor')),
      created_at timestamptz not null default now()
    );
    create table if not exists tasks (
      id uuid primary key default gen_random_uuid(), title text not null,
      description text not null default '', status text not null default 'new' check (status in ('new','in_progress','waiting','done','cancelled')),
      priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
      classroom text, computer text, created_by uuid not null references profiles(id) on delete restrict,
      assigned_to uuid references profiles(id) on delete set null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table if not exists comments (
      id uuid primary key default gen_random_uuid(), task_id uuid not null references tasks(id) on delete cascade,
      author_id uuid not null references profiles(id) on delete restrict, body text not null default '', created_at timestamptz not null default now()
    );
    create table if not exists attachments (
      id uuid primary key default gen_random_uuid(), task_id uuid not null references tasks(id) on delete cascade,
      comment_id uuid references comments(id) on delete cascade, storage_path text not null, url text not null,
      kind text not null default 'other' check (kind in ('problem','solution','other')),
      uploaded_by uuid not null references profiles(id) on delete restrict, created_at timestamptz not null default now()
    );
    create index if not exists tasks_updated_at_idx on tasks(updated_at desc);
    create index if not exists comments_task_id_idx on comments(task_id);
    create index if not exists attachments_task_id_idx on attachments(task_id);
  `)
  const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  if (password) {
    const exists = await pool.query('select 1 from profiles where username=$1', [username])
    if (exists.rowCount === 0) {
      await pool.query('insert into profiles(username,password_hash,full_name,role) values($1,$2,$3,$4)',
        [username, await bcrypt.hash(password, 12), process.env.ADMIN_NAME || 'Администратор', 'admin'])
      console.log(`Created initial administrator: ${username}`)
    }
  }
}

function publicProfile(row, prefix = '') {
  return { id: row[`${prefix}id`], username: row[`${prefix}username`], full_name: row[`${prefix}full_name`], role: row[`${prefix}role`], created_at: row[`${prefix}created_at`] }
}
function sign(profile) { return jwt.sign({ sub: profile.id, role: profile.role }, jwtSecret, { expiresIn: '12h' }) }
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Требуется авторизация.' })
  try {
    const claims = jwt.verify(token, jwtSecret)
    const result = await pool.query('select id, role from profiles where id=$1', [claims.sub])
    if (!result.rows[0]) return res.status(401).json({ error: 'Пользователь не найден.' })
    req.auth = { sub: result.rows[0].id, role: result.rows[0].role }
    next()
  } catch { res.status(401).json({ error: 'Сессия истекла. Войдите снова.' }) }
}
function requireAdmin(req, res, next) {
  if (req.auth.role !== 'admin') return res.status(403).json({ error: 'Недостаточно прав.' })
  next()
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const requested = path.extname(file.originalname).toLowerCase()
    const ext = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(requested) ? requested : '.jpg'
    cb(null, `${Date.now()}-${randomUUID()}${ext}`)
  },
})
const upload = multer({ storage, limits: { fileSize: 12 * 1024 * 1024, files: 10 }, fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('image/')) })
const app = express()
app.set('trust proxy', 1)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors({ origin: allowedOrigins, methods: ['GET', 'POST', 'PATCH', 'DELETE'] }))
app.use(express.json({ limit: '1mb' }))
app.use('/uploads', express.static(uploadDir, { maxAge: '7d', fallthrough: false }))
app.get('/health', (_req, res) => res.json({ ok: true }))

app.post('/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase()
  const result = await pool.query('select * from profiles where username=$1', [username])
  const profile = result.rows[0]
  if (!profile || !(await bcrypt.compare(String(req.body.password || ''), profile.password_hash))) return res.status(401).json({ error: 'Неверный логин или пароль.' })
  res.json({ token: sign(profile), profile: publicProfile(profile) })
})
app.get('/auth/me', authenticate, async (req, res) => {
  const result = await pool.query('select * from profiles where id=$1', [req.auth.sub])
  if (!result.rows[0]) return res.status(401).json({ error: 'Пользователь не найден.' })
  res.json({ profile: publicProfile(result.rows[0]) })
})
app.get('/profiles', authenticate, async (_req, res) => {
  const result = await pool.query('select * from profiles order by full_name, username')
  res.json(result.rows.map((row) => publicProfile(row)))
})
app.post('/profiles', authenticate, requireAdmin, async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase()
  const password = String(req.body.password || '')
  const role = String(req.body.role || 'executor')
  if (!/^[a-z0-9._-]{2,32}$/.test(username)) return res.status(400).json({ error: 'Некорректный логин.' })
  if (password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов.' })
  if (!['admin', 'boss', 'executor'].includes(role)) return res.status(400).json({ error: 'Некорректная роль.' })
  try {
    const result = await pool.query('insert into profiles(username,password_hash,full_name,role) values($1,$2,$3,$4) returning *',
      [username, await bcrypt.hash(password, 12), String(req.body.fullName || '').trim(), role])
    res.status(201).json(publicProfile(result.rows[0]))
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Пользователь с таким логином уже существует.' })
    throw error
  }
})
app.patch('/profiles/:id/role', authenticate, requireAdmin, async (req, res) => {
  const role = String(req.body.role || '')
  if (!['admin', 'boss', 'executor'].includes(role)) return res.status(400).json({ error: 'Некорректная роль.' })
  if (req.params.id === req.auth.sub) return res.status(400).json({ error: 'Нельзя изменить собственную роль.' })
  const result = await pool.query('update profiles set role=$1 where id=$2 returning *', [role, req.params.id])
  if (!result.rows[0]) return res.status(404).json({ error: 'Пользователь не найден.' })
  res.json(publicProfile(result.rows[0]))
})

const taskSelect = `select t.*,
 cp.id creator_id, cp.username creator_username, cp.full_name creator_full_name, cp.role creator_role, cp.created_at creator_created_at,
 ap.id assignee_id, ap.username assignee_username, ap.full_name assignee_full_name, ap.role assignee_role, ap.created_at assignee_created_at,
 (select count(*)::int from comments c where c.task_id=t.id) comment_count
 from tasks t join profiles cp on cp.id=t.created_by left join profiles ap on ap.id=t.assigned_to`
function mapTask(row) {
  return { id: row.id, title: row.title, description: row.description, status: row.status, priority: row.priority,
    classroom: row.classroom, computer: row.computer, created_by: row.created_by, assigned_to: row.assigned_to,
    created_at: row.created_at, updated_at: row.updated_at, creator: publicProfile(row, 'creator_'),
    assignee: row.assignee_id ? publicProfile(row, 'assignee_') : null, comment_count: row.comment_count }
}
app.get('/tasks', authenticate, async (_req, res) => {
  const result = await pool.query(`${taskSelect} order by t.updated_at desc`)
  res.json(result.rows.map(mapTask))
})
app.post('/tasks', authenticate, upload.array('photos'), async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await client.query(`insert into tasks(title,description,priority,classroom,computer,assigned_to,created_by) values($1,$2,$3,$4,$5,$6,$7) returning *`,
      [req.body.title, req.body.description || '', req.body.priority || 'medium', req.body.classroom || null, req.body.computer || null, req.body.assigned_to || null, req.auth.sub])
    const task = result.rows[0]
    for (const file of req.files || []) await client.query(`insert into attachments(task_id,storage_path,url,kind,uploaded_by) values($1,$2,$3,'problem',$4)`,
      [task.id, file.filename, `${publicUrl}/uploads/${file.filename}`, req.auth.sub])
    await client.query('commit')
    res.status(201).json(task)
  } catch (error) {
    await client.query('rollback')
    await Promise.all((req.files || []).map((file) => fs.rm(file.path, { force: true })))
    throw error
  } finally { client.release() }
})
app.get('/tasks/:id', authenticate, async (req, res) => {
  const taskResult = await pool.query(`${taskSelect} where t.id=$1`, [req.params.id])
  if (!taskResult.rows[0]) return res.status(404).json({ error: 'Задача не найдена.' })
  const [comments, attachments] = await Promise.all([
    pool.query(`select c.*, p.id author_id2, p.username author_username, p.full_name author_full_name, p.role author_role, p.created_at author_created_at from comments c join profiles p on p.id=c.author_id where c.task_id=$1 order by c.created_at`, [req.params.id]),
    pool.query('select * from attachments where task_id=$1 order by created_at', [req.params.id]),
  ])
  res.json({ task: mapTask(taskResult.rows[0]), comments: comments.rows.map((row) => ({ ...row, author: publicProfile(row, 'author_') })), attachments: attachments.rows })
})
app.patch('/tasks/:id', authenticate, async (req, res) => {
  const current = await pool.query('select * from tasks where id=$1', [req.params.id])
  if (!current.rows[0]) return res.status(404).json({ error: 'Задача не найдена.' })
  const task = current.rows[0]
  const allowed = req.auth.role === 'admin' || req.auth.role === 'boss' || task.created_by === req.auth.sub || task.assigned_to === req.auth.sub
  if (!allowed) return res.status(403).json({ error: 'Недостаточно прав для изменения задачи.' })
  const fields = ['title', 'description', 'status', 'priority', 'classroom', 'computer', 'assigned_to']
  const updates = fields.filter((field) => Object.hasOwn(req.body, field))
  if (updates.length === 0) return res.json(task)
  const values = updates.map((field) => req.body[field] === '' ? null : req.body[field])
  const set = updates.map((field, index) => `${field}=$${index + 1}`).join(',')
  const result = await pool.query(`update tasks set ${set}, updated_at=now() where id=$${values.length + 1} returning *`, [...values, req.params.id])
  res.json(result.rows[0])
})
app.delete('/tasks/:id', authenticate, async (req, res) => {
  const result = await pool.query('select * from tasks where id=$1', [req.params.id])
  const task = result.rows[0]
  if (!task) return res.status(404).json({ error: 'Задача не найдена.' })
  if (!(req.auth.role === 'admin' || req.auth.role === 'boss' || task.created_by === req.auth.sub)) return res.status(403).json({ error: 'Недостаточно прав для удаления задачи.' })
  const files = await pool.query('select storage_path from attachments where task_id=$1', [req.params.id])
  await pool.query('delete from tasks where id=$1', [req.params.id])
  await Promise.all(files.rows.map((file) => fs.rm(path.join(uploadDir, path.basename(file.storage_path)), { force: true })))
  res.status(204).end()
})
app.post('/tasks/:id/comments', authenticate, upload.array('photos'), async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const exists = await client.query('select 1 from tasks where id=$1', [req.params.id])
    if (!exists.rows[0]) { await client.query('rollback'); return res.status(404).json({ error: 'Задача не найдена.' }) }
    const result = await client.query('insert into comments(task_id,author_id,body) values($1,$2,$3) returning *', [req.params.id, req.auth.sub, req.body.body || ''])
    const kind = ['problem', 'solution', 'other'].includes(req.body.kind) ? req.body.kind : 'other'
    for (const file of req.files || []) await client.query(`insert into attachments(task_id,comment_id,storage_path,url,kind,uploaded_by) values($1,$2,$3,$4,$5,$6)`,
      [req.params.id, result.rows[0].id, file.filename, `${publicUrl}/uploads/${file.filename}`, kind, req.auth.sub])
    await client.query('update tasks set updated_at=now() where id=$1', [req.params.id])
    await client.query('commit')
    res.status(201).json(result.rows[0])
  } catch (error) {
    await client.query('rollback')
    await Promise.all((req.files || []).map((file) => fs.rm(file.path, { force: true })))
    throw error
  } finally { client.release() }
})
app.use((error, _req, res, _next) => {
  console.error(error)
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message })
  res.status(500).json({ error: 'Внутренняя ошибка сервера.' })
})
await migrate()
app.listen(port, '0.0.0.0', () => console.log(`IT Hub API listening on ${port}`))
