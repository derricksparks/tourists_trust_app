import { expect, Page, test } from '@playwright/test';
import { createHmac } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:3000';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '123456:DEV-placeholder-token';

test('home page lists the verified operators', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Туроператоры Восточной Африки');
  await expect(page.getByRole('link', { name: '12 проверенных туроператоров' })).toBeVisible();
  await page.getByRole('link', { name: /^Кения/ }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Туроператоры в Кении');
  await expect(page.locator('.card')).toHaveCount(4);
});

test('an operator page shows what was checked, tours and reviews', async ({ page }) => {
  await page.goto('/operators/pearl-gorilla-treks-demo-ug');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pearl Gorilla Treks (demo)');
  await expect(page.getByText('Номер лицензии сверен с реестром Uganda Tourism Board')).toBeVisible();
  await expect(page.getByText('от 2 450 $ с человека')).toBeVisible();
  await expect(page.getByText('Отличная организация')).toBeVisible();
  // The pending review is not shown.
  await expect(page.getByText('дорога была долгой')).toHaveCount(0);
  const link = page.getByRole('link', { name: 'Задать вопрос в Telegram' });
  await expect(link).toHaveAttribute('href', /t\.me\/.+\?startapp=op_pearl-gorilla-treks-demo-ug$/);
});

test('operators that are not approved have no public page', async ({ page }) => {
  const res = await page.goto('/operators/zanzi-spice-journeys-demo-tz');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
});

test('the visa checklist remembers ticks in this browser', async ({ page }) => {
  await page.goto('/visa/east-african-tourist-visa');
  await expect(page.getByText('действует: Кения, Уганда, Руанда')).toBeVisible();
  await page.getByLabel('Загранпаспорт, действующий 6+ месяцев').check();
  await expect(page.getByText('Готово 1 из 3 обязательных')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Загранпаспорт, действующий 6+ месяцев')).toBeChecked();
});

test('sitemap and robots are served', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/operators/pearl-gorilla-treks-demo-ug');
  expect(sitemap).not.toContain('zanzi-spice');
  expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /tg');
});

const badgeText = (page: Page, id: string) => page.locator(`#${id} ttp-verification-badge a`);

test('the badge works on an unrelated website and ignores its CSS', async ({ page }) => {
  await page.goto('http://localhost:8088/');
  await expect(badgeText(page, 'verified')).toContainText('Проверенный туроператор');
  await expect(badgeText(page, 'verified')).toContainText('Pearl Gorilla Treks (demo)');
  await expect(badgeText(page, 'verified')).toHaveAttribute('href', 'http://localhost:3001/operators/pearl-gorilla-treks-demo-ug');
  await expect(badgeText(page, 'verified-en')).toContainText('Verified tour operator');
  await expect(badgeText(page, 'revoked')).toContainText('Проверка отозвана');
  await expect(badgeText(page, 'unknown')).toContainText('Не подтверждён');
  // The host page sets `a { color: hotpink !important; font-size: 30px !important }`.
  const style = await badgeText(page, 'verified').evaluate((a) => getComputedStyle(a).fontSize);
  expect(style).toBe('14px');
  await expect(page.frameLocator('#frame').getByText('Verified tour operator')).toBeVisible();
});

test('suspending an operator flips every embedded badge to revoked', async ({ page, request }) => {
  const login = await request.post(`${API}/admin/auth/login`, { data: { email: 'moderator@example.com', password: process.env.SEED_ADMIN_PASSWORD ?? 'change-me' } });
  const auth = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const list = await request.get(`${API}/admin/operators?q=Pearl`, { headers: auth });
  const id = (await list.json()).items[0].id;
  await request.post(`${API}/admin/operators/${id}/decision`, { headers: auth, data: { decision: 'suspend', reason: 'e2e test' } });
  try {
    await page.goto('http://localhost:8088/');
    await expect(badgeText(page, 'verified')).toContainText('Проверка отозвана');
    expect((await page.goto('http://localhost:3001/operators/pearl-gorilla-treks-demo-ug'))?.status()).toBe(404);
  } finally {
    await request.post(`${API}/admin/operators/${id}/decision`, { headers: auth, data: { decision: 'approve' } });
  }
});

function signInitData(fields: Record<string, string>) {
  const dataCheck = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(dataCheck).digest('hex') }).toString();
}

/** Opens the Mini App as Telegram would: the official script is replaced by a stand-in carrying signed initData. */
async function openInTelegram(page: Page, startParam: string) {
  const initData = signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    start_param: startParam,
    user: JSON.stringify({ id: 99001, first_name: 'Ольга', username: 'olga_e2e', language_code: 'ru' }),
  });
  await page.route('https://telegram.org/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.addInitScript(
    ({ initData, startParam }) => {
      const noop = () => {};
      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: {
          initData,
          initDataUnsafe: { start_param: startParam },
          colorScheme: 'light',
          ready: noop, expand: noop, close: noop,
          HapticFeedback: { notificationOccurred: noop },
          BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
        },
      };
    },
    { initData, startParam },
  );
  await page.goto('/tg');
}

test('Mini App: a deep link opens the operator and the question reaches the admin inbox', async ({ page, request }) => {
  await openInTelegram(page, 'op_kibale-canopy-walks-demo-ug');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kibale Canopy Walks (demo)');
  await page.getByRole('button', { name: 'Отправить вопрос' }).click();
  await expect(page.locator('form [role=alert]')).toContainText('Напишите хотя бы пару предложений');

  await page.getByLabel('Ваш вопрос').fill('Хотим посмотреть шимпанзе в феврале, нас двое. Есть ли места?');
  await page.getByLabel('Когда').fill('2027-02');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Отправить вопрос' }).click();
  await expect(page.getByRole('status')).toContainText('Вопрос отправлен');

  const login = await request.post(`${API}/admin/auth/login`, { data: { email: 'moderator@example.com', password: process.env.SEED_ADMIN_PASSWORD ?? 'change-me' } });
  const inbox = await request.get(`${API}/admin/inquiries?status=NEW`, { headers: { Authorization: `Bearer ${(await login.json()).accessToken}` } });
  const items = (await inbox.json()).items as { message: string; contactInfo: string; travelMonth: string; operator: { name: string } }[];
  expect(items.find((i) => i.contactInfo === '@olga_e2e')).toMatchObject({
    operator: { name: 'Kibale Canopy Walks (demo)' },
    travelMonth: '2027-02',
  });
});

test('Mini App: outside Telegram the form explains how to use it', async ({ page }) => {
  await page.route('https://telegram.org/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('/tg/operators/pearl-gorilla-treks-demo-ug');
  await expect(page.getByText('Эта форма работает внутри Telegram')).toBeVisible();
});
