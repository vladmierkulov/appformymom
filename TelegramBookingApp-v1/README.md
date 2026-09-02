# BookingApp Telegram Mini App

Free Telegram Mini App replacement for the native iOS BookingApp.

## What it does

- Keeps appointments in a Cloudflare D1 database.
- Shows a calendar, day agenda, prices, phone numbers and daily totals.
- Creates a ready-to-send Telegram message for each client; the owner taps Send.
- Sends the owner a daily Telegram reminder about tomorrow's appointments at 10:00 UTC.

## Deployment requirements

1. Create a bot with @BotFather. Do **not** share its token in chat.
2. Create a Cloudflare account and an API token with Workers and D1 permissions.
3. Create a GitHub repository secret named `CLOUDFLARE_API_TOKEN` and another named `TELEGRAM_BOT_TOKEN`.
4. Run `npx wrangler d1 create booking-app-db`, copy the returned database id into `wrangler.toml`, then run `npm run db:init`.
5. Deploy with `npm run deploy` (or the GitHub Actions workflow). Copy the Worker URL into the `APP_URL` Worker secret and set the bot webhook to `https://YOUR-WORKER/telegram/webhook` with a random `TELEGRAM_WEBHOOK_SECRET`.

The bot must be started by the owner before it can send daily reminders. Telegram does not allow bots to write to arbitrary phone numbers; each client needs to send the bot `/start` if you want to message them directly. This app therefore opens a ready-made message for the owner to send.
