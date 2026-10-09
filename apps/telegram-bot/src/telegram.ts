/**
 * Thin client for the official Telegram Bot API (core.telegram.org/bots/api) over HTTPS.
 * No third-party wrapper, per the project rules; only the methods the bot uses are typed.
 */

export interface User { id: number; first_name?: string; username?: string; language_code?: string }
export interface Message { message_id: number; chat: { id: number; type: string }; from?: User; text?: string }
export interface CallbackQuery { id: string; from: User; message?: Message; data?: string }
export interface Update { update_id: number; message?: Message; callback_query?: CallbackQuery }

export type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string }
  | { text: string; web_app: { url: string } };
export interface InlineKeyboard { inline_keyboard: InlineButton[][] }

export class TelegramError extends Error {
  constructor(readonly method: string, readonly code: number, readonly description: string) {
    super(`${method} failed (${code}): ${description}`);
  }
}

export interface BotApi {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export class HttpBotApi implements BotApi {
  private readonly base: string;

  constructor(token: string, apiBase = 'https://api.telegram.org') {
    this.base = `${apiBase.replace(/\/$/, '')}/bot${token}`;
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 40_000): Promise<T> {
    const res = await fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; error_code?: number; description?: string };
    if (!data.ok) throw new TelegramError(method, data.error_code ?? res.status, data.description ?? 'Unknown error');
    return data.result as T;
  }
}

/** Escapes text for parse_mode HTML. */
export const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
