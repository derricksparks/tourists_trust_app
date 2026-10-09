import { Bot, configureBot } from './bot';
import { HttpCoreApi } from './core';
import { HttpBotApi, TelegramError, Update } from './telegram';

/**
 * Runs the bot with long polling (getUpdates). Suits a single always-on process; switch to a
 * webhook when hosting supports it. Only one polling process may run per bot token.
 */
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const siteUrl = process.env.SITE_URL;
  if (!token || !siteUrl) throw new Error('Set TELEGRAM_BOT_TOKEN and SITE_URL (see .env.example)');
  if (!siteUrl.startsWith('https://')) console.warn('SITE_URL is not HTTPS: Telegram will refuse to open the Mini App buttons.');

  const telegram = new HttpBotApi(token, process.env.TELEGRAM_API_BASE);
  const bot = new Bot(telegram, new HttpCoreApi(process.env.API_URL ?? 'http://localhost:3000'), { siteUrl });

  await telegram.call('deleteWebhook', {});
  await configureBot(telegram, { siteUrl }).catch((e: Error) => console.warn(`Bot setup skipped: ${e.message}`));
  console.log('Bot is polling for updates');

  let offset = 0;
  let stopping = false;
  const stop = () => (stopping = true);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    try {
      const updates = await telegram.call<Update[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      for (const update of updates) {
        offset = update.update_id + 1;
        // One bad update must not stop the loop or be retried forever.
        await bot.handle(update).catch((e: Error) => console.error(`Update ${update.update_id} failed: ${e.message}`));
      }
    } catch (e) {
      if (e instanceof TelegramError && e.code === 401) throw new Error('Telegram rejected the bot token');
      console.error(`Polling failed, retrying in 5s: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
