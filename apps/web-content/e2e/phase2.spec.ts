import { expect, Page, test } from '@playwright/test';
import { createHmac } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:3000';
const TELEGRAM = 'http://localhost:8099';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '123456:DEV-placeholder-token';
const AMINA_CHAT = '100000101'; // seeded translator's Telegram id

type Call = { method: string; chat_id?: string; text?: string; reply_markup?: { inline_keyboard: { callback_data?: string; url?: string }[][] } };
const telegramCalls = async (page: Page) => (await (await page.request.get(`${TELEGRAM}/__messages`)).json()) as Call[];

function signInitData(fields: Record<string, string>) {
  const dataCheck = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(dataCheck).digest('hex') }).toString();
}

async function openInTelegram(page: Page, path: string, userId: number, username: string) {
  const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId, first_name: 'Тест', username }) });
  await page.route('https://telegram.org/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.addInitScript((initData) => {
    const noop = () => {};
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: { initData, initDataUnsafe: {}, colorScheme: 'light', ready: noop, expand: noop, close: noop, HapticFeedback: { notificationOccurred: noop }, BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop } },
    };
  }, initData);
  await page.goto(path);
}

test.beforeEach(async ({ request }) => {
  await request.delete(`${TELEGRAM}/__messages`);
});

test('the translator directory lists only verified people, with no contacts', async ({ page }) => {
  await page.goto('/translators');
  await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Амина (демо)', 'Ванджиру (демо)', 'Питер (демо)']);
  await expect(page.getByText('Джозеф (демо)')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('demo_amina');
  await page.getByRole('link', { name: 'Уганда', exact: true }).click();
  await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Питер (демо)']);
  await expect(page.getByRole('link', { name: 'Заказать в Telegram' })).toHaveAttribute('href', /startapp=tr_[0-9a-f-]{36}$/);
});

test('the insurance page compares published insurers only', async ({ page }) => {
  await page.goto('/insurance');
  const rows = page.locator('table.compare tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('table.compare')).not.toContainText('Демо Страхование Б');
  await expect(page.locator('table.compare')).not.toContainText('not yet confirmed');
  await expect(rows.first()).toContainText('✓ подтверждена');
});

test('a review link works exactly once', async ({ page }) => {
  await page.goto('/review/demo-review-link-kilima-horizon-0000000001');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Как прошла поездка с Kilima Horizon Safaris (demo)?');
  await page.getByRole('button', { name: 'Отправить отзыв' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Поставьте общую оценку' })).toBeVisible();
  await page.getByRole('radio', { name: 'Общая оценка: 4 из 5' }).click();
  await page.getByRole('radio', { name: 'Гид: 5 из 5' }).click();
  await page.getByLabel('Расскажите о поездке').fill('Серенгети — восторг, гид знал каждое животное. Лодж попроще, чем на фото.');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Отправить отзыв' }).click();
  await expect(page.getByRole('status')).toContainText('после проверки модератором');
  await page.reload();
  await expect(page.getByText('По этой ссылке отзыв уже оставлен')).toBeVisible();
});

test('Mini App: a translator applies', async ({ page }) => {
  await openInTelegram(page, '/tg/translator-signup', 777001, 'new_guide');
  await page.getByLabel('Имя, как показывать в каталоге').fill('Grace (e2e)');
  await page.getByLabel('Уровень: русский').selectOption('B2');
  await page.getByRole('checkbox', { name: 'английский' }).check();
  await page.getByLabel('Уровень: английский').selectOption('native');
  await page.getByLabel('Где работаете').selectOption('KE');
  await page.getByText('городской гид').click();
  await page.getByText('Согласен на публикацию').click();
  await page.getByRole('button', { name: 'Отправить анкету' }).click();
  await expect(page.getByRole('status')).toContainText('Заявка принята');
});

test('Mini App: a traveller requests a translator, who gets the offer and accepts in the bot', async ({ page, request }) => {
  await page.goto('/translators?country=TZ');
  const href = await page.getByRole('link', { name: 'Заказать в Telegram' }).getAttribute('href');
  const translatorId = href!.split('tr_')[1];

  await openInTelegram(page, `/tg/translators/${translatorId}`, 777002, 'traveller_e2e');
  await expect(page.getByRole('heading', { name: 'Амина (демо)' })).toBeVisible();
  await page.getByLabel('На язык').selectOption('sw');
  await page.getByLabel('Что нужно сделать').fill('Нужен гид-переводчик на рынке в Аруше на 3 часа.');
  await page.getByText('Согласен, чтобы переводчик получил').click();
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByRole('status')).toContainText('Заявка отправлена');

  const offer = (await telegramCalls(page)).find((c) => c.method === 'sendMessage' && c.chat_id === AMINA_CHAT);
  expect(offer?.text).toContain('русский → суахили');
  const accept = offer!.reply_markup!.inline_keyboard[0][0].callback_data!;
  const jobId = accept.split(':')[2];

  // What the bot process does when Amina presses "Принять".
  const secret = createHmac('sha256', BOT_TOKEN).update('ttp-bot-internal').digest('hex');
  const res = await request.post(`${API}/bot/jobs/${jobId}/action`, { headers: { 'X-Bot-Secret': secret }, data: { telegramId: Number(AMINA_CHAT), action: 'accept' } });
  expect(res.ok()).toBe(true);
  const handoff = (await telegramCalls(page)).filter((c) => c.method === 'sendMessage' && c.chat_id === '777002');
  expect(handoff.at(-1)?.text).toContain('@demo_amina');
});
