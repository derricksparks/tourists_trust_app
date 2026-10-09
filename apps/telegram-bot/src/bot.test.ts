import type { PublicCountry, PublicOperatorDetail, PublicOperatorSummary } from '@ttp/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { Bot, configureBot } from './bot';
import type { CoreApi } from './core';
import type { BotApi, InlineKeyboard } from './telegram';

class FakeTelegram implements BotApi {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  async call<T>(method: string, params: Record<string, unknown> = {}) {
    this.calls.push({ method, params });
    return {} as T;
  }
  last(method: string) {
    return [...this.calls].reverse().find((c) => c.method === method)?.params as { text: string; reply_markup: InlineKeyboard } & Record<string, unknown>;
  }
}

const summary = (slug: string, name: string, rating: number | null): PublicOperatorSummary => ({
  slug, name, countryCode: 'UG', licensingAuthority: 'Uganda Tourism Board', yearEstablished: 2011, descriptionRu: null,
  verifiedSince: '2026-09-01T10:00:00.000Z', reviewCount: rating ? 2 : 0, averageRating: rating, packageCount: 1,
});
const detail: PublicOperatorDetail = {
  ...summary('pearl', 'Pearl <Treks> & Co', 4.5),
  descriptionRu: 'Гориллы в Бвинди.', descriptionEn: null, tourismBoardLicense: 'L', businessRegNumber: 'R', websiteUrl: null,
  verificationVideoUrl: null, telegramUsername: null, responseTimeScore: null, completenessScore: null,
  country: { code: 'UG', nameEn: 'Uganda', nameRu: 'Уганда' },
  packages: [{ slug: 'p', title: 'Trek', titleRu: 'Трек', descriptionRu: null, durationDays: 4, price: '100', currency: 'USD', priceBasis: 'PER_PERSON', capacity: 6, inclusions: [], exclusions: [], dates: [] }],
  reviews: [],
};
const core: CoreApi = {
  countries: async (): Promise<PublicCountry[]> => [
    { code: 'KE', nameEn: 'Kenya', nameRu: 'Кения', operatorCount: 0 },
    { code: 'UG', nameEn: 'Uganda', nameRu: 'Уганда', operatorCount: 2 },
  ],
  operators: async (c) => (c === 'UG' ? [summary('pearl', 'Pearl', 4.5), summary('x'.repeat(70), 'Long Slug Ltd', null)] : []),
  operator: async (slug) => (slug === 'pearl' ? detail : null),
};

const SITE = 'https://site.example';
let tg: FakeTelegram;
let bot: Bot;
const message = (text: string) => ({ update_id: 1, message: { message_id: 1, chat: { id: 7, type: 'private' }, from: { id: 7, first_name: 'Ольга' }, text } });
const press = (data: string) => ({ update_id: 2, callback_query: { id: 'q1', from: { id: 7 }, data, message: { message_id: 50, chat: { id: 7, type: 'private' } } } });
const buttons = (kb: InlineKeyboard) => kb.inline_keyboard.flat();

beforeEach(() => {
  tg = new FakeTelegram();
  bot = new Bot(tg, core, { siteUrl: SITE });
});

describe('bot', () => {
  it('/start greets by name, opens the Mini App and offers countries with operators', async () => {
    await bot.handle(message('/start'));
    const sent = tg.last('sendMessage');
    expect(sent.chat_id).toBe(7);
    expect(sent.text).toContain('Ольга, здравствуйте!');
    expect(sent.text).toContain('У каждого из 2 мы проверили');
    expect(buttons(sent.reply_markup)).toEqual([
      { text: 'Открыть каталог', web_app: { url: `${SITE}/tg` } },
      { text: 'Уганда · 2', callback_data: 'c:UG' },
      { text: 'Визы и документы', url: `${SITE}/visa` },
    ]);
  });

  it('/start op_<slug> goes straight to that operator, with HTML escaped', async () => {
    await bot.handle(message('/start op_pearl'));
    const sent = tg.last('sendMessage');
    expect(sent.text).toContain('<b>Pearl &lt;Treks&gt; &amp; Co</b>');
    expect(sent.text).toContain('Проверен с сентября 2026');
    expect(sent.text).toContain('★ 4,5 · 2 отзыва');
    expect(sent.text).toContain('• Трек — 4 дня');
    expect(buttons(sent.reply_markup)[0]).toEqual({ text: 'Задать вопрос', web_app: { url: `${SITE}/tg/operators/pearl` } });
  });

  it('a country button lists its operators in place, linking long slugs to the site', async () => {
    await bot.handle(press('c:UG'));
    expect(tg.last('answerCallbackQuery')).toEqual({ callback_query_id: 'q1' });
    const edit = tg.last('editMessageText');
    expect(edit).toMatchObject({ chat_id: 7, message_id: 50, parse_mode: 'HTML' });
    expect(edit.text).toContain('<b>Уганда</b>: 2 проверенных туроператора');
    expect(buttons(edit.reply_markup)).toEqual([
      { text: 'Pearl · ★ 4,5', callback_data: 'o:pearl' },
      { text: 'Long Slug Ltd', url: `${SITE}/operators/${'x'.repeat(70)}` },
      { text: '← Страны', callback_data: 'countries' },
    ]);
  });

  it('tells the user when an operator is no longer listed', async () => {
    await bot.handle(press('o:gone'));
    expect(tg.last('answerCallbackQuery')).toMatchObject({ text: 'Этот туроператор больше не проходит проверку.', show_alert: true });
    expect(tg.last('editMessageText')).toBeUndefined();
  });

  it('answers unknown text with the country picker and ignores group chats', async () => {
    await bot.handle(message('привет'));
    expect(tg.last('sendMessage').text).toContain('понимаю только кнопки');
    tg.calls = [];
    await bot.handle({ update_id: 3, message: { message_id: 1, chat: { id: -100, type: 'group' }, text: '/start' } });
    expect(tg.calls).toEqual([]);
  });

  it('sets up commands and the Mini App menu button', async () => {
    await configureBot(tg, { siteUrl: `${SITE}/` });
    expect(tg.calls.map((c) => c.method)).toEqual(['setMyCommands', 'setChatMenuButton']);
    expect(tg.last('setChatMenuButton')).toEqual({ menu_button: { type: 'web_app', text: 'Каталог', web_app: { url: `${SITE}/tg` } } });
  });
});
