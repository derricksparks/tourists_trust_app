import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

export interface SentMessage {
  chat_id: string;
  text: string;
  parse_mode?: string;
  reply_markup?: { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] };
}

/** Stand-in for api.telegram.org's sendMessage. Chats listed in `blocked` answer 403 like a user who blocked the bot. */
export async function startFakeTelegram(botToken: string) {
  const messages: SentMessage[] = [];
  const blocked = new Set<string>();
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msg = JSON.parse(body || '{}');
      if (req.url !== `/bot${botToken}/sendMessage`) return res.end(JSON.stringify({ ok: false, error_code: 404, description: 'Not Found' }));
      if (blocked.has(msg.chat_id)) return res.end(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }));
      messages.push(msg);
      res.end(JSON.stringify({ ok: true, result: {} }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    messages,
    blocked,
    to: (chatId: number | bigint) => messages.filter((m) => m.chat_id === String(chatId)),
    close: () => server.close(),
  };
}
