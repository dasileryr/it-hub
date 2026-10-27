import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import webpush from 'web-push'

const { Pool } = pg
const port = Number(process.env.PORT || 3000)
const uploadDir = process.env.UPLOAD_DIR || '/app/uploads'
const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
const jwtSecret = process.env.JWT_SECRET
const appUrl = (process.env.APP_URL || '').replace(/\/$/, '')
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || ''
const telegramApiBaseUrl = (process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org').replace(/\/$/, '')
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || ''
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || ''
if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.org', vapidPublicKey, vapidPrivateKey)
}
let telegramBotUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '')
let telegramUpdateOffset = 0
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
    alter table profiles add column if not exists deleted_at timestamptz;
    create table if not exists app_settings (
      key text primary key,
      value text not null
    );
    create table if not exists telegram_invites (
      token text primary key,
      created_by uuid not null references profiles(id) on delete cascade,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      used_at timestamptz
    );
    create table if not exists telegram_subscribers (
      chat_id text primary key,
      telegram_username text,
      display_name text not null default '',
      invited_by uuid references profiles(id) on delete set null,
      active boolean not null default true,
      created_at timestamptz not null default now()
    );
    alter table telegram_subscribers add column if not exists notify_task_created boolean not null default false;
    alter table telegram_subscribers add column if not exists notification_mode text not null default 'all_completed';
    alter table telegram_subscribers add column if not exists notification_user_id uuid references profiles(id) on delete set null;
    alter table telegram_subscribers add column if not exists profile_id uuid references profiles(id) on delete set null;
    update telegram_subscribers set notification_mode='all_completed_and_assigned'
      where notify_task_created=true and notification_mode='all_completed';
    create table if not exists tasks (
      id uuid primary key default gen_random_uuid(), title text not null,
      description text not null default '', status text not null default 'new' check (status in ('new','in_progress','waiting','done','cancelled')),
      priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
      classroom text, computer text, created_by uuid not null references profiles(id) on delete restrict,
      assigned_to uuid references profiles(id) on delete set null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    alter table tasks add column if not exists archived_at timestamptz;
    update tasks set archived_at=updated_at where status='done' and archived_at is null;
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
    create table if not exists telegram_pending_comments (
      chat_id text primary key references telegram_subscribers(chat_id) on delete cascade,
      task_id uuid not null references tasks(id) on delete cascade,
      created_at timestamptz not null default now()
    );
    create table if not exists magic_login_tokens (
      token_hash text primary key,
      profile_id uuid not null references profiles(id) on delete cascade,
      destination text not null default '/',
      expires_at timestamptz not null,
      used_at timestamptz
    );
    create table if not exists push_subscriptions (
      endpoint text primary key,
      profile_id uuid not null references profiles(id) on delete cascade,
      p256dh text not null,
      auth text not null,
      created_at timestamptz not null default now()
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
    const result = await pool.query('select id, role from profiles where id=$1 and deleted_at is null', [claims.sub])
    if (!result.rows[0]) return res.status(401).json({ error: 'Пользователь не найден.' })
    req.auth = { sub: result.rows[0].id, role: result.rows[0].role }
    next()
  } catch { res.status(401).json({ error: 'Сессия истекла. Войдите снова.' }) }
}
function requireAdmin(req, res, next) {
  if (req.auth.role !== 'admin') return res.status(403).json({ error: 'Недостаточно прав.' })
  next()
}

async function telegramCall(method, payload = {}) {
  if (!telegramBotToken) throw new Error('Telegram bot is not configured')
  const response = await fetch(`${telegramApiBaseUrl}/bot${telegramBotToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(35_000),
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API error: ${response.status}`)
  return result.result
}

async function telegramMultipartCall(method, fields, files) {
  if (!telegramBotToken) throw new Error('Telegram bot is not configured')
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, typeof value === 'string' ? value : JSON.stringify(value))
  for (const file of files) {
    const filename = path.basename(file.storage_path)
    const contents = await fs.readFile(path.join(uploadDir, filename))
    const ext = path.extname(filename).toLowerCase()
    const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
    form.append(file.field, new Blob([contents], { type }), filename)
  }
  const response = await fetch(`${telegramApiBaseUrl}/bot${telegramBotToken}/${method}`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(60_000),
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API error: ${response.status}`)
  return result.result
}

async function sendTelegramMessage(chatId, text, replyMarkup) {
  return telegramCall('sendMessage', {
    chat_id: chatId, text, disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
}

function hashMagicToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

async function createMagicLoginUrl(profileId, destination) {
  if (!profileId || !appUrl) return null
  const token = randomBytes(32).toString('hex')
  await pool.query(
    `insert into magic_login_tokens(token_hash,profile_id,destination,expires_at)
     values($1,$2,$3,now() + interval '30 minutes')`,
    [hashMagicToken(token), profileId, destination],
  )
  return `${appUrl}/?login=${token}#${destination}`
}

async function telegramTaskKeyboard(taskId, profileId) {
  if (!profileId) return undefined
  const loginUrl = await createMagicLoginUrl(profileId, `/tasks/${taskId}`)
  const buttons = [{ text: '💬 Добавить комментарий', callback_data: `comment:${taskId}` }]
  if (loginUrl) buttons.push({ text: '⚡ Открыть без пароля', url: loginUrl })
  return { inline_keyboard: [buttons] }
}

async function answerTelegramCallback(callbackQueryId, text) {
  return telegramCall('answerCallbackQuery', { callback_query_id: callbackQueryId, text })
}

async function handleTelegramCallback(query) {
  const chatId = query.message?.chat?.id
  const match = String(query.data || '').match(/^comment:([a-f0-9-]{36})$/i)
  if (!chatId || !match) return answerTelegramCallback(query.id, 'Команда устарела.')
  const subscriber = await pool.query(
    `select ts.profile_id from telegram_subscribers ts join profiles p on p.id=ts.profile_id
     where ts.chat_id=$1 and ts.active=true and p.deleted_at is null`,
    [String(chatId)],
  )
  if (!subscriber.rows[0]?.profile_id) {
    await answerTelegramCallback(query.id, 'Сначала администратор должен связать Telegram с аккаунтом.')
    return
  }
  const task = await pool.query('select title from tasks where id=$1', [match[1]])
  if (!task.rows[0]) return answerTelegramCallback(query.id, 'Задача больше не существует.')
  await pool.query(
    `insert into telegram_pending_comments(chat_id,task_id,created_at) values($1,$2,now())
     on conflict(chat_id) do update set task_id=excluded.task_id, created_at=now()`,
    [String(chatId), match[1]],
  )
  await answerTelegramCallback(query.id, 'Теперь отправьте текст комментария.')
  await sendTelegramMessage(chatId, `Напишите комментарий к задаче «${task.rows[0].title}».\n\n/cancel — отменить.`)
}

async function handleTelegramUpdate(update) {
  if (update.callback_query) return handleTelegramCallback(update.callback_query)
  const message = update.message
  const text = message?.text?.trim() || ''
  const chatId = message?.chat?.id
  if (!chatId) return

  if (/^\/cancel(?:@\w+)?$/i.test(text)) {
    await pool.query('delete from telegram_pending_comments where chat_id=$1', [String(chatId)])
    await sendTelegramMessage(chatId, 'Добавление комментария отменено.')
    return
  }

  if (/^\/stop(?:@\w+)?$/i.test(text)) {
    await pool.query(
      'update telegram_subscribers set active=false where chat_id=$1',
      [String(chatId)],
    )
    await sendTelegramMessage(chatId, 'Отчёты ИТ-Задач отключены. Для повторного подключения понадобится новая ссылка-приглашение.')
    return
  }

  if (text && !text.startsWith('/')) {
    const pending = await pool.query(
      `select pc.task_id, ts.profile_id, t.title
       from telegram_pending_comments pc join telegram_subscribers ts on ts.chat_id=pc.chat_id
       join profiles p on p.id=ts.profile_id join tasks t on t.id=pc.task_id
       where pc.chat_id=$1 and ts.active=true and p.deleted_at is null
       and pc.created_at > now() - interval '1 hour'`,
      [String(chatId)],
    )
    if (pending.rows[0]) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(
          `insert into comments(task_id,author_id,body) values($1,$2,$3)`,
          [pending.rows[0].task_id, pending.rows[0].profile_id, text],
        )
        await client.query('update tasks set updated_at=now() where id=$1', [pending.rows[0].task_id])
        await client.query('delete from telegram_pending_comments where chat_id=$1', [String(chatId)])
        await client.query('commit')
        await sendTelegramMessage(chatId, `Комментарий добавлен к задаче «${pending.rows[0].title}».`)
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally { client.release() }
      return
    }
  }

  const match = text.match(/^\/start(?:@\w+)?\s+([a-f0-9]{48})$/i)
  if (!match) {
    await sendTelegramMessage(chatId, 'Для подключения отчётов откройте ссылку-приглашение, которую прислал администратор ИТ-Задач.')
    return
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await client.query(
      `update telegram_invites set used_at=now()
       where token=$1 and used_at is null and expires_at > now()
       returning created_by`,
      [match[1]],
    )
    if (!result.rows[0]) {
      await client.query('rollback')
      await sendTelegramMessage(chatId, 'Ссылка недействительна или истекла. Получите новую ссылку в приложении.')
      return
    }
    const displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ')
    await client.query(
      `insert into telegram_subscribers(chat_id,telegram_username,display_name,invited_by,active)
       values($1,$2,$3,$4,true)
       on conflict(chat_id) do update set telegram_username=excluded.telegram_username,
       display_name=excluded.display_name, invited_by=excluded.invited_by, active=true`,
      [String(chatId), message.from?.username || null, displayName, result.rows[0].created_by],
    )
    await client.query(
      `update telegram_subscribers ts set profile_id=p.id from profiles p
       where ts.chat_id=$1 and ts.profile_id is null and p.deleted_at is null
       and lower(p.username)=lower(coalesce(ts.telegram_username,''))`,
      [String(chatId)],
    )
    await client.query('commit')
    await sendTelegramMessage(chatId, 'Готово! Подписка на отчёты ИТ-Задач подключена. Администратор может настроить состав уведомлений. Команда /stop отключает отчёты.')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function pollTelegram() {
  if (!telegramBotToken) return
  try {
    const updates = await telegramCall('getUpdates', {
      offset: telegramUpdateOffset,
      timeout: 25,
      allowed_updates: ['message', 'callback_query'],
    })
    for (const update of updates) {
      try { await handleTelegramUpdate(update) }
      catch (error) { console.error('Telegram update failed:', error.message) }
      telegramUpdateOffset = Math.max(telegramUpdateOffset, update.update_id + 1)
    }
    if (updates.length > 0) {
      await pool.query(
        `insert into app_settings(key,value) values('telegram_update_offset',$1)
         on conflict(key) do update set value=excluded.value`,
        [String(telegramUpdateOffset)],
      )
    }
  } catch (error) {
    console.error('Telegram polling failed:', error.message)
  } finally {
    setTimeout(pollTelegram, 2_000)
  }
}

async function startTelegramBot() {
  if (!telegramBotToken) {
    console.log('Telegram bot is disabled')
    return
  }
  try {
    const bot = await telegramCall('getMe')
    telegramBotUsername = bot.username
    const offset = await pool.query("select value from app_settings where key='telegram_update_offset'")
    telegramUpdateOffset = Number(offset.rows[0]?.value || 0)
    console.log(`Telegram bot started: @${telegramBotUsername}`)
    pollTelegram()
  } catch (error) {
    console.error('Telegram bot startup failed:', error.message)
    setTimeout(startTelegramBot, 10_000)
  }
}

const STATUS_LABELS = {
  new: 'Новая', in_progress: 'В работе', waiting: 'Ожидает', done: 'Решена', cancelled: 'Отменена',
}
const PRIORITY_LABELS = { low: 'Низкий', medium: 'Средний', high: 'Высокий', urgent: 'Срочный' }

async function sendTelegramReport(chatId, text, photos, replyMarkup) {
  if (photos.length === 0) return sendTelegramMessage(chatId, text, replyMarkup)
  if (photos.length === 1) {
    return telegramMultipartCall('sendPhoto', {
      chat_id: chatId, caption: text.slice(0, 1024), ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }, [
      { ...photos[0], field: 'photo' },
    ])
  }
  const selected = photos.slice(0, 10)
  return telegramMultipartCall('sendMediaGroup', {
    chat_id: chatId,
    media: selected.map((_photo, index) => ({
      type: 'photo', media: `attach://photo${index}`, ...(index === 0 ? { caption: text.slice(0, 1024) } : {}),
    })),
  }, selected.map((photo, index) => ({ ...photo, field: `photo${index}` }))).then(async (result) => {
    if (replyMarkup) await sendTelegramMessage(chatId, 'Действия с задачей:', replyMarkup)
    return result
  })
}

async function notifyTaskStatusChanged(task, actorId) {
  if (!telegramBotToken) return
  const [people, comment] = await Promise.all([
    pool.query(
      `select creator.full_name creator_name, creator.username creator_username,
       actor.full_name actor_name, actor.username actor_username,
       assignee.full_name assignee_name, assignee.username assignee_username
       from profiles creator join profiles actor on actor.id=$2
       left join profiles assignee on assignee.id=$3 where creator.id=$1`,
      [task.created_by, actorId, task.assigned_to],
    ),
    pool.query(
      `select c.id, c.body, p.full_name author_name, p.username author_username
       from comments c join profiles p on p.id=c.author_id
       where c.task_id=$1 and c.author_id=$2 order by c.created_at desc limit 1`,
      [task.id, actorId],
    ),
  ])
  const person = people.rows[0]
  const latestComment = comment.rows[0]
  const photos = latestComment ? (await pool.query(
    `select url, storage_path from attachments where task_id=$1 and comment_id=$2 and kind='solution'
     order by created_at limit 10`,
    [task.id, latestComment.id],
  )).rows : []
  const subscribers = await pool.query(
    `select chat_id, profile_id from telegram_subscribers
     where active=true and (
       notification_mode='all_completed_and_assigned'
       or ($2='done' and notification_mode='all_completed')
       or ($2='done' and notification_mode='user_completed' and notification_user_id=$1)
     )
     order by created_at`,
    [actorId, task.status],
  )
  if (subscribers.rowCount === 0) return

  const creator = person?.creator_name || `@${person?.creator_username || '—'}`
  const actor = person?.actor_name || `@${person?.actor_username || '—'}`
  const assignee = person?.assignee_name || (person?.assignee_username ? `@${person.assignee_username}` : 'не назначен')
  const location = [task.classroom && `аудитория ${task.classroom}`, task.computer && `компьютер ${task.computer}`]
    .filter(Boolean).join(', ')
  const lines = [
    `📋 Статус задачи: ${STATUS_LABELS[task.status] || task.status}`,
    '',
    `Задача: ${task.title}`,
    `Чья задача: ${creator}`,
    `Исполнитель: ${assignee}`,
    `Изменил: ${actor}`,
  ]
  if (location) lines.push(`Место: ${location}`)
  if (latestComment?.body) lines.push('', `Комментарий: ${latestComment.body}`)
  if (appUrl) lines.push('', `${appUrl}/#/tasks/${task.id}`)
  const text = lines.join('\n')
  await Promise.allSettled(subscribers.rows.map(async ({ chat_id: chatId, profile_id: profileId }) =>
    sendTelegramReport(chatId, text, photos, await telegramTaskKeyboard(task.id, profileId))))
}

async function notifyTaskCreated(task) {
  if (!telegramBotToken) return
  const [people, photos, subscribers] = await Promise.all([
    pool.query(
      `select creator.full_name creator_name, creator.username creator_username,
       assignee.full_name assignee_name, assignee.username assignee_username
       from profiles creator left join profiles assignee on assignee.id=$2
       where creator.id=$1`,
      [task.created_by, task.assigned_to],
    ),
    pool.query(
      `select url, storage_path from attachments where task_id=$1 and comment_id is null
       order by created_at limit 10`,
      [task.id],
    ),
    pool.query(
      `select chat_id, profile_id from telegram_subscribers
       where active=true and notification_mode='all_completed_and_assigned' order by created_at`,
    ),
  ])
  if (subscribers.rowCount === 0) return

  const person = people.rows[0]
  const creator = person?.creator_name || `@${person?.creator_username || '—'}`
  const assignee = person?.assignee_name || (person?.assignee_username ? `@${person.assignee_username}` : 'не назначен')
  const location = [task.classroom && `аудитория ${task.classroom}`, task.computer && `компьютер ${task.computer}`]
    .filter(Boolean).join(', ')
  const lines = [
    '🆕 Создана новая задача',
    '',
    `Задача: ${task.title}`,
    `Создал: ${creator}`,
    `Исполнитель: ${assignee}`,
    `Приоритет: ${PRIORITY_LABELS[task.priority] || task.priority}`,
  ]
  if (location) lines.push(`Место: ${location}`)
  if (task.description) lines.push('', `Описание: ${task.description.slice(0, 1500)}`)
  if (appUrl) lines.push('', `${appUrl}/#/tasks/${task.id}`)
  const text = lines.join('\n')
  await Promise.allSettled(
    subscribers.rows.map(async ({ chat_id: chatId, profile_id: profileId }) =>
      sendTelegramReport(chatId, text, photos.rows, await telegramTaskKeyboard(task.id, profileId))),
  )
}

async function notifyTaskAssigned(task, actorId) {
  if (!telegramBotToken || !task.assigned_to) return
  const [people, subscribers] = await Promise.all([
    pool.query(
      `select actor.full_name actor_name, actor.username actor_username,
       assignee.full_name assignee_name, assignee.username assignee_username
       from profiles actor join profiles assignee on assignee.id=$2 where actor.id=$1`,
      [actorId, task.assigned_to],
    ),
    pool.query(
      `select chat_id, profile_id from telegram_subscribers
       where active=true and notification_mode='all_completed_and_assigned' order by created_at`,
    ),
  ])
  if (subscribers.rowCount === 0) return
  const person = people.rows[0]
  const actor = person?.actor_name || `@${person?.actor_username || '—'}`
  const assignee = person?.assignee_name || `@${person?.assignee_username || '—'}`
  const lines = ['👤 Задача назначена', '', `Задача: ${task.title}`, `Исполнитель: ${assignee}`, `Назначил: ${actor}`]
  if (appUrl) lines.push('', `${appUrl}/#/tasks/${task.id}`)
  await Promise.allSettled(subscribers.rows.map(async ({ chat_id: chatId, profile_id: profileId }) =>
    sendTelegramMessage(chatId, lines.join('\n'), await telegramTaskKeyboard(task.id, profileId))))
}

async function sendPushToUser(profileId, payload) {
  if (!profileId || !vapidPublicKey || !vapidPrivateKey) return
  const subscriptions = await pool.query(
    'select endpoint, p256dh, auth from push_subscriptions where profile_id=$1',
    [profileId],
  )
  await Promise.allSettled(subscriptions.rows.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify(payload), { TTL: 60 * 60 })
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await pool.query('delete from push_subscriptions where endpoint=$1', [subscription.endpoint])
      } else {
        console.error('Push notification failed:', error.message)
      }
    }
  }))
}

function pushTask(profileId, title, body, taskId) {
  return sendPushToUser(profileId, { title, body, url: `${appUrl}/#/tasks/${taskId}`, taskId })
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
  const profile = result.rows[0]?.deleted_at ? null : result.rows[0]
  if (!profile || !(await bcrypt.compare(String(req.body.password || ''), profile.password_hash))) return res.status(401).json({ error: 'Неверный логин или пароль.' })
  res.json({ token: sign(profile), profile: publicProfile(profile) })
})
app.post('/auth/magic', async (req, res) => {
  const rawToken = String(req.body.token || '')
  if (!/^[a-f0-9]{64}$/.test(rawToken)) return res.status(400).json({ error: 'Некорректная ссылка.' })
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await client.query(
      `update magic_login_tokens mt set used_at=now() from profiles p
       where mt.token_hash=$1 and mt.profile_id=p.id and mt.used_at is null
       and mt.expires_at > now() and p.deleted_at is null
       returning p.*, mt.destination`,
      [hashMagicToken(rawToken)],
    )
    if (!result.rows[0]) {
      await client.query('rollback')
      return res.status(400).json({ error: 'Ссылка уже использована или истекла.' })
    }
    await client.query('commit')
    const profile = result.rows[0]
    res.json({ token: sign(profile), profile: publicProfile(profile), destination: profile.destination })
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally { client.release() }
})
app.get('/auth/me', authenticate, async (req, res) => {
  const result = await pool.query('select * from profiles where id=$1', [req.auth.sub])
  if (!result.rows[0]) return res.status(401).json({ error: 'Пользователь не найден.' })
  res.json({ profile: publicProfile(result.rows[0]) })
})
app.get('/telegram/status', authenticate, requireAdmin, async (_req, res) => {
  const result = await pool.query(
    `select chat_id, telegram_username, display_name, created_at, notification_mode, notification_user_id, profile_id
     from telegram_subscribers where active=true order by created_at`,
  )
  res.json({
    enabled: Boolean(telegramBotToken && telegramBotUsername),
    bot_username: telegramBotUsername || null,
    subscribers: result.rows,
  })
})
app.patch('/telegram/subscribers/:chatId', authenticate, requireAdmin, async (req, res) => {
  const mode = String(req.body.notification_mode || '')
  const userId = req.body.notification_user_id || null
  const profileId = req.body.profile_id || null
  if (!['all_completed', 'all_completed_and_assigned', 'user_completed'].includes(mode)) {
    return res.status(400).json({ error: 'Некорректный режим уведомлений.' })
  }
  if (mode === 'user_completed') {
    if (!userId) return res.status(400).json({ error: 'Выберите пользователя.' })
    const profile = await pool.query('select 1 from profiles where id=$1', [userId])
    if (!profile.rows[0]) return res.status(400).json({ error: 'Пользователь не найден.' })
  }
  if (profileId) {
    const linkedProfile = await pool.query('select 1 from profiles where id=$1 and deleted_at is null', [profileId])
    if (!linkedProfile.rows[0]) return res.status(400).json({ error: 'Связанный аккаунт не найден.' })
  }
  const result = await pool.query(
    `update telegram_subscribers set notification_mode=$1, notification_user_id=$2, profile_id=$3
     where chat_id=$4 and active=true
     returning chat_id, telegram_username, display_name, created_at, notification_mode, notification_user_id, profile_id`,
    [mode, mode === 'user_completed' ? userId : null, profileId, req.params.chatId],
  )
  if (!result.rows[0]) return res.status(404).json({ error: 'Получатель не найден.' })
  res.json(result.rows[0])
})
app.post('/telegram/invites', authenticate, requireAdmin, async (req, res) => {
  if (!telegramBotToken || !telegramBotUsername) return res.status(503).json({ error: 'Telegram-бот ещё не настроен.' })
  const token = randomBytes(24).toString('hex')
  const result = await pool.query(
    `insert into telegram_invites(token,created_by,expires_at)
     values($1,$2,now() + interval '7 days') returning expires_at`,
    [token, req.auth.sub],
  )
  res.json({ url: `https://t.me/${telegramBotUsername}?start=${token}`, expires_at: result.rows[0].expires_at })
})
app.delete('/telegram/subscribers/:chatId', authenticate, requireAdmin, async (req, res) => {
  await pool.query('update telegram_subscribers set active=false where chat_id=$1', [req.params.chatId])
  res.status(204).end()
})
app.get('/profiles', authenticate, async (_req, res) => {
  const result = await pool.query('select * from profiles where deleted_at is null order by full_name, username')
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
  const result = await pool.query('update profiles set role=$1 where id=$2 and deleted_at is null returning *', [role, req.params.id])
  if (!result.rows[0]) return res.status(404).json({ error: 'Пользователь не найден.' })
  res.json(publicProfile(result.rows[0]))
})
app.patch('/profiles/:id', authenticate, requireAdmin, async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase()
  const fullName = String(req.body.fullName || '').trim()
  if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
    return res.status(400).json({ error: 'Логин: 2–32 символа, только латиница, цифры, точка, дефис и подчёркивание.' })
  }
  if (!fullName || fullName.length > 120) return res.status(400).json({ error: 'Укажите имя пользователя длиной до 120 символов.' })
  try {
    const result = await pool.query(
      `update profiles set username=$1,full_name=$2 where id=$3 and deleted_at is null returning *`,
      [username, fullName, req.params.id],
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Пользователь не найден.' })
    res.json(publicProfile(result.rows[0]))
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Пользователь с таким логином уже существует.' })
    throw error
  }
})
app.patch('/profiles/:id/password', authenticate, requireAdmin, async (req, res) => {
  const password = String(req.body.password || '')
  if (password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов.' })
  if (password.length > 200) return res.status(400).json({ error: 'Пароль слишком длинный.' })
  const result = await pool.query(
    `update profiles set password_hash=$1 where id=$2 and deleted_at is null returning id`,
    [await bcrypt.hash(password, 12), req.params.id],
  )
  if (!result.rows[0]) return res.status(404).json({ error: 'Пользователь не найден.' })
  res.status(204).end()
})
app.delete('/profiles/:id', authenticate, requireAdmin, async (req, res) => {
  if (req.params.id === req.auth.sub) return res.status(400).json({ error: 'Нельзя удалить собственную учётную запись.' })
  const result = await pool.query(
    `update profiles set deleted_at=now() where id=$1 and deleted_at is null returning id`,
    [req.params.id],
  )
  if (!result.rows[0]) return res.status(404).json({ error: 'Пользователь не найден.' })
  await pool.query('delete from push_subscriptions where profile_id=$1', [req.params.id])
  res.status(204).end()
})

app.get('/push/config', authenticate, (_req, res) => {
  res.json({ enabled: Boolean(vapidPublicKey && vapidPrivateKey), publicKey: vapidPublicKey || null })
})
app.post('/push/subscriptions', authenticate, async (req, res) => {
  const { endpoint, keys } = req.body || {}
  if (!vapidPublicKey || !vapidPrivateKey) return res.status(503).json({ error: 'Push-уведомления ещё не настроены.' })
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Некорректная push-подписка.' })
  await pool.query(
    `insert into push_subscriptions(endpoint,profile_id,p256dh,auth) values($1,$2,$3,$4)
     on conflict(endpoint) do update set profile_id=excluded.profile_id,p256dh=excluded.p256dh,auth=excluded.auth`,
    [endpoint, req.auth.sub, keys.p256dh, keys.auth],
  )
  res.status(204).end()
})
app.delete('/push/subscriptions', authenticate, async (req, res) => {
  const endpoint = String(req.body?.endpoint || '')
  if (endpoint) await pool.query('delete from push_subscriptions where endpoint=$1 and profile_id=$2', [endpoint, req.auth.sub])
  res.status(204).end()
})

const taskSelect = `select t.*,
 cp.id creator_id, cp.username creator_username, cp.full_name creator_full_name, cp.role creator_role, cp.created_at creator_created_at,
 ap.id assignee_id, ap.username assignee_username, ap.full_name assignee_full_name, ap.role assignee_role, ap.created_at assignee_created_at,
 (select count(*)::int from comments c where c.task_id=t.id) comment_count
 from tasks t join profiles cp on cp.id=t.created_by left join profiles ap on ap.id=t.assigned_to`
function mapTask(row) {
  return { id: row.id, title: row.title, description: row.description, status: row.status, priority: row.priority,
    classroom: row.classroom, computer: row.computer, created_by: row.created_by, assigned_to: row.assigned_to,
    created_at: row.created_at, updated_at: row.updated_at, archived_at: row.archived_at, creator: publicProfile(row, 'creator_'),
    assignee: row.assignee_id ? publicProfile(row, 'assignee_') : null, comment_count: row.comment_count }
}
app.get('/tasks', authenticate, async (req, res) => {
  const archived = req.query.archived === 'true'
  const result = await pool.query(`${taskSelect} where t.archived_at is ${archived ? 'not null' : 'null'} order by t.updated_at desc`)
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
    notifyTaskCreated(task).catch((error) => console.error('Telegram notification failed:', error.message))
    if (task.assigned_to) pushTask(task.assigned_to, 'Новая задача', task.title, task.id)
      .catch((error) => console.error('Push notification failed:', error.message))
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
  const setParts = updates.map((field, index) => `${field}=$${index + 1}`)
  if (updates.includes('status')) {
    const statusIndex = updates.indexOf('status') + 1
    setParts.push(`archived_at=case when $${statusIndex}='done' then coalesce(archived_at,now()) else null end`)
  }
  const set = setParts.join(',')
  const result = await pool.query(`update tasks set ${set}, updated_at=now() where id=$${values.length + 1} returning *`, [...values, req.params.id])
  if (task.status !== result.rows[0].status) {
    notifyTaskStatusChanged(result.rows[0], req.auth.sub)
      .catch((error) => console.error('Telegram notification failed:', error.message))
    if (result.rows[0].status === 'done') pushTask(task.created_by, 'Задача выполнена', task.title, task.id)
      .catch((error) => console.error('Push notification failed:', error.message))
  }
  if (task.assigned_to !== result.rows[0].assigned_to) {
    notifyTaskAssigned(result.rows[0], req.auth.sub)
      .catch((error) => console.error('Telegram notification failed:', error.message))
    if (result.rows[0].assigned_to) pushTask(result.rows[0].assigned_to, 'Вам назначена задача', task.title, task.id)
      .catch((error) => console.error('Push notification failed:', error.message))
  }
  res.json(result.rows[0])
})
app.post('/tasks/:id/reopen', authenticate, async (req, res) => {
  const current = await pool.query('select * from tasks where id=$1', [req.params.id])
  const task = current.rows[0]
  if (!task) return res.status(404).json({ error: 'Задача не найдена.' })
  const allowed = req.auth.role === 'admin' || req.auth.role === 'boss' || task.created_by === req.auth.sub || task.assigned_to === req.auth.sub
  if (!allowed) return res.status(403).json({ error: 'Недостаточно прав для повторного открытия задачи.' })
  const result = await pool.query(
    `update tasks set status='in_progress',archived_at=null,updated_at=now() where id=$1 returning *`,
    [req.params.id],
  )
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
app.delete('/comments/:id', authenticate, requireAdmin, async (req, res) => {
  const files = await pool.query('select storage_path from attachments where comment_id=$1', [req.params.id])
  const result = await pool.query('delete from comments where id=$1 returning task_id', [req.params.id])
  if (!result.rows[0]) return res.status(404).json({ error: 'Комментарий не найден.' })
  await pool.query('update tasks set updated_at=now() where id=$1', [result.rows[0].task_id])
  await Promise.all(files.rows.map((file) => fs.rm(path.join(uploadDir, path.basename(file.storage_path)), { force: true })))
  res.status(204).end()
})
app.use((error, _req, res, _next) => {
  console.error(error)
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message })
  res.status(500).json({ error: 'Внутренняя ошибка сервера.' })
})
await migrate()
app.listen(port, '0.0.0.0', () => console.log(`IT Hub API listening on ${port}`))
startTelegramBot()
