import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';

export class TelegramApiError extends Error {
  constructor(
    readonly errorCode: number,
    readonly description: string,
  ) {
    super(`Telegram API error ${errorCode}: ${description}`);
  }
}

/**
 * The few official Bot API methods the core API calls (core.telegram.org/bots/api), over plain HTTPS.
 * TELEGRAM_API_BASE can point at a local stand-in for tests.
 */
@Injectable()
export class TelegramBotApi {
  async sendMessage(chatId: bigint | number | string, text: string, extra: Record<string, unknown> = {}): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new TelegramApiError(503, 'Telegram is not configured');
    const base = (process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/$/, '');
    const res = await fetch(`${base}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId.toString(), text, link_preview_options: { is_disabled: true }, ...extra }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error_code?: number; description?: string };
    if (!data.ok) throw new TelegramApiError(data.error_code ?? res.status, data.description ?? 'Unknown error');
  }
}

/**
 * Shared secret between the bot process and the API, derived from the bot token so no extra
 * setting is needed. The bot sends it as X-Bot-Secret when forwarding button presses.
 */
export function botInternalSecret(botToken: string): string {
  return createHmac('sha256', botToken).update('ttp-bot-internal').digest('hex');
}
