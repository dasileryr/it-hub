# ИТ-Задачи

Внутренний трекер задач ИТ-отдела. Фронтенд размещается на GitHub Pages, API,
PostgreSQL и фотографии — на собственном Ubuntu-сервере.

## Стек

- React 19, TypeScript, Vite, Tailwind CSS
- Node.js, Express
- PostgreSQL
- Docker Compose и Nginx

## Локальный запуск фронтенда

```bash
npm install
echo 'VITE_API_URL=http://localhost:8092' > .env
npm run dev
```

## Запуск backend

```bash
cd server
cp .env.example .env
# Замените пароли, JWT_SECRET, PUBLIC_URL и ALLOWED_ORIGINS.
docker compose up -d --build
```

API слушает только `127.0.0.1:8092`; наружу его следует публиковать через
Nginx и HTTPS. При первом запуске автоматически создаётся схема БД и начальный
администратор из `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

## Возможности

- вход по логину и паролю;
- роли «Админ», «Начальник», «Исполнитель»;
- создание, назначение и изменение задач;
- аудитории и номера компьютеров;
- комментарии о ходе решения;
- фотографии проблемы и результата;
- поиск и фильтры;
- автоматическое обновление списка каждые 10 секунд.
- Telegram-отчёты выбранным получателям об изменениях статусов всех задач.

## Telegram-уведомления

Создайте бота через `@BotFather`, затем заполните в `server/.env`:

```bash
APP_URL=https://your-name.github.io/it-hub
TELEGRAM_BOT_TOKEN=123456:your-token
TELEGRAM_BOT_USERNAME=your_bot
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your-api-hash
TELEGRAM_PROXY_SERVER=proxy.example.org
TELEGRAM_PROXY_PORT=443
TELEGRAM_PROXY_SECRET=your-mtproto-secret
```

Локальный Telegram Bot API подключается к Telegram через MTProto-прокси.
Backend получает сообщения через long polling, поэтому отдельный webhook и
публичный порт для бота не нужны. Администратор создаёт одноразовую ссылку на
странице «Telegram», отправляет её получателю, а бот присылает ему отчёты об
изменении статусов с автором задачи, исполнителем, комментарием и фото решения.

## Развёртывание

Workflow `.github/workflows/deploy.yml` собирает фронтенд и публикует его на
GitHub Pages. Адрес API передаётся в сборку через `VITE_API_URL`.

Backend хранит состояние в Docker volumes `postgres_data` и `uploads_data`.
Эти volumes необходимо включить в резервное копирование сервера.
