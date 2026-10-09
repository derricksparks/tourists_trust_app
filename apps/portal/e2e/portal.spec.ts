import { expect, Page, test } from '@playwright/test';

const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'change-me';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password / Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in / Войти' }).click();
}

test('an operator sees scores, adds a tour and publishes it', async ({ page }) => {
  await signIn(page, 'operator@example.com');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pearl Gorilla Treks (demo)');
  await expect(page.getByRole('meter', { name: 'Response time score' })).toBeVisible();
  await page.getByRole('link', { name: 'Tours', exact: true }).click();
  await page.getByRole('link', { name: 'Add a tour' }).click();
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.getByText('Give the tour a name')).toBeVisible();

  await page.getByLabel('Name (English)').fill('Queen Elizabeth Park Safari (e2e)');
  await page.getByLabel('Name in Russian').fill('Сафари в Королеве Елизавете (e2e)');
  await page.getByLabel('Days').fill('3');
  await page.getByLabel('From price (optional)').fill('890');
  await page.getByRole('checkbox', { name: 'guide' }).check();
  await page.getByRole('button', { name: 'Add dates' }).click();
  await page.getByLabel('Start').fill('2027-04-02');
  await page.getByLabel('End').fill('2027-04-04');
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('alert')).toContainText('Russian description');
  await page.getByLabel('Description in Russian').fill('Сафари на машине и катере по каналу Казинга.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('status')).toHaveText('Tour is now published.');
  await expect(page.getByRole('link', { name: 'View on the site' })).toBeVisible();
});

test('an operator answers a quote request', async ({ page }) => {
  await signIn(page, 'operator@example.com');
  await page.getByRole('link', { name: /^Quote requests/ }).click();
  const card = page.locator('article', { hasText: 'Солнечный Путь (demo)' });
  await card.getByRole('button', { name: 'Send quote' }).click();
  await expect(card.getByRole('alert')).toHaveText('Enter your price.');
  await card.getByLabel('Net price').fill('2100');
  await card.getByLabel('Terms').fill('Per person, double rooms, permits included, valid 30 days');
  await card.getByRole('button', { name: 'Send quote' }).click();
  await expect(card.getByText('Quoted', { exact: true })).toBeVisible();
  await expect(card).toContainText('US$2,100');
});

test('a Russian DMC applies and waits for approval', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Название компании').fill('Тест Тур (e2e)');
  await page.getByLabel('Контактное лицо').fill('Ольга');
  await page.getByLabel('Email (это ваш логин)').fill('e2e-dmc@example.com');
  await page.getByLabel('Пароль').fill('short');
  await page.getByRole('button', { name: 'Подать заявку' }).click();
  await expect(page.getByText('Пароль — не короче 10 символов')).toBeVisible();
  await page.getByLabel('Пароль').fill('long-enough-password');
  await page.getByRole('button', { name: 'Подать заявку' }).click();
  await expect(page.getByRole('heading', { name: 'Заявка на проверке' })).toBeVisible();
});

test('an approved DMC browses, asks for a price, sells a tour under its brand and joins a fam trip', async ({ page, request }) => {
  await signIn(page, 'dmc@example.com');
  await expect(page.getByRole('heading', { name: 'Проверенные туры Восточной Африки' })).toBeVisible();
  await page.getByRole('button', { name: 'Кения' }).click();
  const card = page.locator('article', { hasText: 'Цаво и пляжи Диани' });
  await card.getByRole('button', { name: 'Запросить нетто-цену' }).click();
  await card.getByLabel('Человек').fill('10');
  await card.getByLabel('Комментарий').fill('Группа из Казани');
  await card.getByRole('button', { name: 'Отправить запрос' }).click();
  await expect(card.getByRole('status')).toContainText('Запрос отправлен');

  await card.getByRole('button', { name: 'Продавать под своим брендом' }).click();
  await expect(card.getByRole('status')).toContainText('добавлен в «Мои туры»');
  await page.getByRole('link', { name: 'Мои туры' }).click();
  const listing = page.locator('article', { hasText: 'Цаво и пляжи Диани' });
  await listing.getByLabel('Страница тура на вашем сайте').fill('https://severny-veter.example.com/kenya-beach');
  await listing.getByRole('button', { name: 'Сохранить' }).click();
  await expect(listing.getByRole('status')).toHaveText('Сохранено.');
  await listing.getByText('Текст для вашего сайта').click();
  await expect(listing.getByLabel('Текст тура')).not.toContainText('Diani Reef Escapes');

  const pkgSlug = new URL(await listing.getByRole('link', { name: 'страница тура на нашем сайте' }).getAttribute('href') as string).pathname.split('/').pop();
  const pub = await (await request.get(`${process.env.API_URL ?? 'http://localhost:3000'}/public/packages/${pkgSlug}`)).json();
  expect(pub.sellers).toContainEqual(expect.objectContaining({ url: 'https://severny-veter.example.com/kenya-beach' }));

  await page.getByRole('link', { name: 'Инфотуры' }).click();
  const trip = page.locator('article', { hasText: 'Kenya & Tanzania safari fam trip (demo)' });
  await trip.getByLabel('Кто поедет от компании').fill('Анна Петрова');
  await trip.getByRole('button', { name: 'Подать заявку' }).click();
  await expect(trip.getByText('Заявка подана')).toBeVisible();
});

test('a pending DMC sees no catalogue', async ({ page }) => {
  await signIn(page, 'dmc-pending@example.com');
  await expect(page.getByRole('heading', { name: 'Заявка на проверке' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Запросы цен' })).toHaveCount(0);
});
