# Мой блокнот — Telegram Mini App

Приложение для записи клиентов внутри Telegram: календарь, список клиентов, стоимость визитов и готовые сообщения.

[Открыть бота](https://t.me/calendarbookingminiappbot)

## Что находится в репозитории

- `TelegramBookingApp-v1/public/` — интерфейс, стили и логика мини-аппа.
- `TelegramBookingApp-v1/src/worker.js` — сервер и Telegram-бот на Cloudflare Workers.
- `TelegramBookingApp-v1/schema.sql` — структура базы записей Cloudflare D1.
- `TelegramBookingApp-v1/tests/` — проверки календаря, записей и доступа к данным.
- `TelegramBookingApp-v1/scripts/preview.mjs` — локальный предпросмотр.
- `.github/workflows/deploy-telegram.yml` — проверка и публикация мини-аппа.

## Локальный запуск

Нужен Node.js 24 или новее.

```sh
cd TelegramBookingApp-v1
npm install
npm run preview
```

Откройте http://127.0.0.1:4173/__preview. Предпросмотр запускается пустым, хранит введённые данные только в памяти и не связан с рабочей базой или отправкой сообщений.

Для проверки кода:

```sh
npm run check
npm test
```

## Публикация

Изменения мини-аппа в ветке `main` запускают тесты и развёртывание в существующий Cloudflare Worker. Для публикации нужен секрет GitHub Actions `CLOUDFLARE_API_TOKEN`.

[Подробная настройка бота, базы и переменных](TelegramBookingApp-v1/README.md).

Рабочие записи хранятся в Cloudflare D1 и привязаны к Telegram-аккаунту. База данных и её содержимое не входят в этот репозиторий.

