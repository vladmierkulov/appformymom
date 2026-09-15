# BookingApp Telegram Mini App

Free Telegram Mini App replacement for the native iOS BookingApp.

## What it does

- Keeps appointments in a Cloudflare D1 database.
- Shows a calendar, day agenda, prices, phone numbers and daily totals.
- Creates a ready-to-send Telegram message for each client; the owner taps Send.
- Sends the owner a daily Telegram reminder about tomorrow's appointments at 10:00 UTC.

## Deployment requirements

1. Create a bot with @BotFather. Keep its token private.
2. In Cloudflare, create the D1 database and bind it as `DB` in the Worker. The checked-in `wrangler.toml` already contains this project's database id.
3. In the Worker settings, add the secrets/variables `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (a random value) and `APP_URL` (the HTTPS Worker URL).
4. Set the bot webhook to `https://YOUR-WORKER/telegram/webhook`, using the same `TELEGRAM_WEBHOOK_SECRET` as the request header secret.
5. Add a GitHub Actions secret `CLOUDFLARE_API_TOKEN` with permission to deploy this Worker. A push to `TelegramBookingApp-v1/` runs checks and then deploys it; the same deploy can be run manually from Actions.

For a local visual check, run `npm run preview` and open `http://127.0.0.1:4173/__preview`. The preview uses disposable in-memory data and never sends Telegram messages.

Run `npm test` for the pure calendar helpers and Worker API tests. The CI workflow uses Node 24 because the Worker tests use the built-in SQLite adapter.

The bot must be started by the owner before it can send daily reminders. Telegram does not allow bots to write to arbitrary phone numbers; each client needs to send the bot `/start` if you want to message them directly. This app therefore opens a ready-made message for the owner to send.
