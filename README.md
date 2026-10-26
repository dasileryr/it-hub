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

## Развёртывание

Workflow `.github/workflows/deploy.yml` собирает фронтенд и публикует его на
GitHub Pages. Адрес API передаётся в сборку через `VITE_API_URL`.

Backend хранит состояние в Docker volumes `postgres_data` и `uploads_data`.
Эти volumes необходимо включить в резервное копирование сервера.
