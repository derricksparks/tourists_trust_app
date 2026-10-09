import type { PublicOperatorDetail } from '@ttp/shared-types';
import type { CoreApi } from './core';
import { BotApi, CallbackQuery, html, InlineButton, InlineKeyboard, Message, Update } from './telegram';

export interface BotConfig {
  /** Public site, e.g. https://example.ru. The Mini App lives at SITE_URL/tg. */
  siteUrl: string;
}

const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const sinceRu = (iso: string) => {
  const d = new Date(iso);
  return `с ${MONTHS_GENITIVE[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
function plural(n: number, [one, few, many]: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Telegram limits callback_data to 64 bytes; longer slugs fall back to a link to the site. */
const fitsCallback = (data: string) => Buffer.byteLength(data, 'utf8') <= 64;

/**
 * Handles one update from Telegram. Stateless: everything needed to answer a button press is in its
 * callback_data, so the bot can restart or run several copies without losing conversations.
 *
 * Commands: /start [op_<slug>], /operators, /help.
 * Callbacks: c:<country> lists operators, o:<slug> shows one, home returns to the start screen.
 */
export class Bot {
  constructor(
    private readonly telegram: BotApi,
    private readonly core: CoreApi,
    private readonly config: BotConfig,
  ) {}

  private get site() {
    return this.config.siteUrl.replace(/\/$/, '');
  }

  async handle(update: Update): Promise<void> {
    if (update.message?.text && update.message.chat.type === 'private') return this.onMessage(update.message);
    if (update.callback_query) return this.onCallback(update.callback_query);
  }

  private async onMessage(msg: Message) {
    const [command, payload] = (msg.text ?? '').trim().split(/\s+/, 2);
    const chatId = msg.chat.id;
    switch (command.replace(/@\w+$/, '')) {
      case '/start':
        if (payload?.startsWith('op_')) {
          const op = await this.core.operator(payload.slice(3));
          if (op) return this.send(chatId, this.operatorCard(op));
        }
        return this.send(chatId, await this.home(msg.from?.first_name));
      case '/operators':
        return this.send(chatId, await this.countryPicker());
      case '/help':
        return this.send(chatId, this.help());
      default:
        return this.send(chatId, {
          text: 'Я пока понимаю только кнопки и команды. Выберите страну или откройте каталог:',
          reply_markup: (await this.countryPicker()).reply_markup,
        });
    }
  }

  private async onCallback(q: CallbackQuery) {
    const data = q.data ?? '';
    const message = q.message;
    let screen: Screen | null = null;
    let notice: string | undefined;

    if (data === 'home') screen = await this.home(q.from.first_name);
    else if (data === 'countries') screen = await this.countryPicker();
    else if (data.startsWith('c:')) screen = await this.operatorList(data.slice(2));
    else if (data.startsWith('o:')) {
      const op = await this.core.operator(data.slice(2));
      if (op) screen = this.operatorCard(op);
      else notice = 'Этот туроператор больше не проходит проверку.';
    }

    await this.telegram.call('answerCallbackQuery', { callback_query_id: q.id, ...(notice && { text: notice, show_alert: true }) });
    if (!screen || !message) return;
    // Replace the screen in place so the chat doesn't fill up with menus.
    await this.telegram.call('editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: screen.text,
      parse_mode: 'HTML',
      reply_markup: screen.reply_markup,
      link_preview_options: { is_disabled: true },
    });
  }

  private async send(chatId: number, screen: Screen): Promise<void> {
    await this.telegram.call('sendMessage', {
      chat_id: chatId,
      text: screen.text,
      parse_mode: 'HTML',
      reply_markup: screen.reply_markup,
      link_preview_options: { is_disabled: true },
    });
  }

  private async home(firstName?: string): Promise<Screen> {
    const countries = await this.core.countries();
    const total = countries.reduce((a, c) => a + c.operatorCount, 0);
    return {
      text: [
        `${firstName ? `${html(firstName)}, здравствуйте!` : 'Здравствуйте!'} Это каталог проверенных туроператоров Уганды, Танзании и Кении.`,
        '',
        `У каждого из ${total} мы проверили лицензию, регистрацию компании и видео офиса и машин. Отзывы — только от тех, кто реально съездил.`,
        '',
        'Выберите страну или откройте каталог. Вопрос туроператору можно задать прямо отсюда — мы его передадим.',
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Открыть каталог', web_app: { url: `${this.site}/tg` } }],
          ...this.countryRows(countries),
          [{ text: 'Визы и документы', url: `${this.site}/visa` }],
        ],
      },
    };
  }

  private async countryPicker(): Promise<Screen> {
    const countries = await this.core.countries();
    return {
      text: 'Выберите страну:',
      reply_markup: { inline_keyboard: [...this.countryRows(countries), [{ text: 'Открыть каталог', web_app: { url: `${this.site}/tg` } }]] },
    };
  }

  private countryRows(countries: { code: string; nameRu: string; operatorCount: number }[]): InlineButton[][] {
    const buttons = countries.filter((c) => c.operatorCount > 0).map((c) => ({ text: `${c.nameRu} · ${c.operatorCount}`, callback_data: `c:${c.code}` }));
    return buttons.length ? [buttons] : [];
  }

  private async operatorList(country: string): Promise<Screen> {
    const [countries, operators] = await Promise.all([this.core.countries(), this.core.operators(country)]);
    const name = countries.find((c) => c.code === country)?.nameRu ?? country;
    const rows: InlineButton[][] = operators.map((op) => {
      const label = `${op.name}${op.averageRating !== null ? ` · ★ ${op.averageRating.toLocaleString('ru-RU')}` : ''}`;
      const cb = `o:${op.slug}`;
      return [fitsCallback(cb) ? { text: label, callback_data: cb } : { text: label, url: `${this.site}/operators/${op.slug}` }];
    });
    return {
      text: operators.length
        ? `<b>${html(name)}</b>: ${operators.length} ${plural(operators.length, ['проверенный туроператор', 'проверенных туроператора', 'проверенных туроператоров'])}. Выберите компанию:`
        : `<b>${html(name)}</b>: проверенных туроператоров пока нет.`,
      reply_markup: { inline_keyboard: [...rows, [{ text: '← Страны', callback_data: 'countries' }]] },
    };
  }

  private operatorCard(op: PublicOperatorDetail): Screen {
    const lines = [
      `<b>${html(op.name)}</b>`,
      `✅ Проверен${op.verifiedSince ? ` ${sinceRu(op.verifiedSince)}` : ''} · лицензия ${html(op.licensingAuthority)}`,
      `${html(op.country.nameRu)}${op.yearEstablished ? ` · работает с ${op.yearEstablished} года` : ''}`,
    ];
    if (op.averageRating !== null) {
      lines.push(`★ ${op.averageRating.toLocaleString('ru-RU')} · ${op.reviewCount} ${plural(op.reviewCount, ['отзыв', 'отзыва', 'отзывов'])}`);
    }
    if (op.descriptionRu) lines.push('', html(op.descriptionRu));
    if (op.packages.length) {
      lines.push('', '<b>Туры:</b>');
      for (const p of op.packages.slice(0, 5)) lines.push(`• ${html(p.titleRu ?? p.title)} — ${p.durationDays} ${plural(p.durationDays, ['день', 'дня', 'дней'])}`);
    }
    const back = `c:${op.countryCode}`;
    return {
      text: lines.join('\n'),
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Задать вопрос', web_app: { url: `${this.site}/tg/operators/${op.slug}` } }],
          [{ text: 'Проверка, туры и отзывы', url: `${this.site}/operators/${op.slug}` }],
          [{ text: '← Назад', callback_data: back }],
        ],
      },
    };
  }

  private help(): Screen {
    return {
      text: [
        '/operators — выбрать страну и туроператора',
        '/start — главное меню',
        '',
        'Задать вопрос: откройте карточку туроператора и нажмите «Задать вопрос». Ответ придёт сюда.',
        'Мы не принимаем платежи и не продаём туры — только проверяем туроператоров и помогаем связаться.',
      ].join('\n'),
      reply_markup: { inline_keyboard: [[{ text: 'Открыть каталог', web_app: { url: `${this.site}/tg` } }]] },
    };
  }
}

interface Screen {
  text: string;
  reply_markup: InlineKeyboard;
}

/** One-time setup: command list and the menu button that opens the Mini App. */
export async function configureBot(telegram: BotApi, config: BotConfig) {
  await telegram.call('setMyCommands', {
    commands: [
      { command: 'operators', description: 'Проверенные туроператоры' },
      { command: 'start', description: 'Главное меню' },
      { command: 'help', description: 'Как это работает' },
    ],
    language_code: 'ru',
  });
  await telegram.call('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Каталог', web_app: { url: `${config.siteUrl.replace(/\/$/, '')}/tg` } },
  });
}
