import { expect, Page, test } from '@playwright/test';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(process.env.SEED_ADMIN_PASSWORD ?? 'change-me');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting for a decision' })).toBeVisible();
}

test('a moderator works the approval queue', async ({ page }) => {
  await signIn(page, 'moderator@example.com');
  await page.getByRole('link', { name: /Operators to review/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);

  await page.getByRole('link', { name: 'Zanzi Spice Journeys (demo)' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved. Zanzi Spice Journeys (demo) is now approved.');
  await expect(page.locator('.history li').first()).toContainText('Approved by Demo Moderator');

  await page.getByRole('link', { name: '← Operators' }).click();
  await page.getByRole('button', { name: /^Pending/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: 'Nile Source Adventures (demo)' }).click();
  await page.getByLabel('Reason').fill('Licence scan unreadable; asked for a new copy.');
  await page.getByRole('button', { name: 'Flag' }).click();
  await expect(page.locator('.pill').first()).toHaveText('Flagged');
  await expect(page.locator('.reason')).toContainText('Licence scan unreadable');
});

test('a moderator adds an operator by hand and edits it', async ({ page }) => {
  await signIn(page, 'moderator@example.com');
  await page.goto('/operators/new');
  await page.getByLabel('Trading name').fill('Mara Dawn Expeditions (demo)');
  await page.getByLabel('Country').selectOption('KE');
  await page.getByLabel('Licensing authority').fill('Tourism Regulatory Authority (Kenya)');
  await page.getByLabel('Tourism licence number').fill('TRA-E2E-1');
  await page.getByLabel('Business registration number').fill('PVT-E2E-1');
  await page.getByLabel('Physical address').fill('Narok, Kenya');
  await page.getByLabel(/^Website/).fill('not a url');
  await page.getByRole('button', { name: 'Add operator' }).click();
  await expect(page.getByText('Enter a full web address starting with https://')).toBeVisible();

  await page.getByLabel(/^Website/).fill('https://mara-dawn.example.com');
  await page.getByRole('button', { name: 'Add operator' }).click();
  await expect(page.getByRole('heading', { name: 'Mara Dawn Expeditions (demo)' })).toBeVisible();
  await expect(page.locator('.pill').first()).toHaveText('Pending');

  await page.getByRole('link', { name: 'Edit details' }).click();
  await page.getByLabel(/^Website/).fill('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Website').locator('xpath=following-sibling::dd[1]')).toHaveText('Not given');
  await expect(page.locator('.history li').first()).toContainText('Edited by Demo Moderator');
});

test('a moderator publishes a review', async ({ page }) => {
  await signIn(page, 'moderator@example.com');
  await page.getByRole('link', { name: /^Reviews/ }).click();
  await expect(page.getByText('Всё хорошо, но дорога была долгой. (демо)')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Nothing to moderate.')).toBeVisible();
  await page.getByRole('button', { name: 'Published' }).click();
  await expect(page.getByText('Всё хорошо, но дорога была долгой. (демо)')).toBeVisible();
});

test('a content editor can look but not decide', async ({ page }) => {
  await signIn(page, 'editor@example.com');
  await page.goto('/operators');
  await expect(page.getByRole('link', { name: 'Add operator' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Pearl Gorilla Treks (demo)' }).click();
  await expect(page.getByText('Only moderators can approve or reject operators.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Suspend' })).toHaveCount(0);
});

test('signing out ends the session', async ({ page }) => {
  await signIn(page, 'admin@example.com');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/operators');
  await expect(page).toHaveURL(/\/login$/);
});

test('a moderator works the inquiry inbox', async ({ page }) => {
  await signIn(page, 'moderator@example.com');
  await page.getByRole('link', { name: /^Inquiries/ }).click();
  const card = page.locator('article', { hasText: 'Сколько стоит сафари на 5 дней?' });
  await expect(card).toContainText('Kilima Horizon Safaris (demo)');
  await expect(card).toContainText('Forward to the operator: info@kilima-horizon-safaris-demo-tz.example.com');
  await card.getByRole('button', { name: 'Send to traveller' }).click();
  await expect(card.getByRole('alert')).toHaveText('Write the answer before sending.');
  await card.getByRole('button', { name: 'Mark answered without sending' }).click();
  await expect(page.getByText('Сколько стоит сафари на 5 дней?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Answered' }).click();
  await expect(page.getByText('Сколько стоит сафари на 5 дней?')).toBeVisible();
});

test('a content editor updates a visa guide and the site shows it', async ({ page, request }) => {
  await signIn(page, 'editor@example.com');
  await page.getByRole('link', { name: 'Visa guides' }).click();
  await page.getByRole('link', { name: 'Электронная виза в Уганду' }).click();
  await page.getByLabel('Processing time (Russian)').fill('обычно 3–5 рабочих дней');
  await page.getByLabel('I checked these facts against the official source today').check();
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByLabel('Item 5 (Russian)').fill('Бронь гостиницы');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Visa guides' })).toBeVisible();

  const res = await request.get(`${process.env.API_URL ?? 'http://localhost:3000'}/public/visa-guides/uganda-evisa`);
  const guide = await res.json();
  expect(guide.processingTime).toBe('обычно 3–5 рабочих дней');
  expect(guide.checklistItems.at(-1)).toEqual({ key: 'item_5', labelRu: 'Бронь гостиницы', required: true });
});

test('a moderator can read guides but not change them', async ({ page }) => {
  await signIn(page, 'moderator@example.com');
  await page.getByRole('link', { name: 'Travel guides' }).click();
  await expect(page.getByRole('link', { name: 'New' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Как добраться до Уганды' }).click();
  await expect(page.getByText('Only content editors can change guides.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

test('the operator page gives the badge code to send the operator', async ({ page }) => {
  await signIn(page, 'moderator@example.com');
  await page.goto('/operators?q=Pearl');
  await page.getByRole('link', { name: 'Pearl Gorilla Treks (demo)' }).click();
  await expect(page.getByLabel('Badge embed code')).toHaveValue(/data-ttp-badge="demo-badge-pearl-gorilla-treks"/);
  await expect(page.getByText('Currently shows: Verified')).toBeVisible();
});

test('a moderator verifies a translator after checking their Russian', async ({ page }) => {
  await signIn(page, 'moderator@example.com');
  await page.getByRole('link', { name: /^Translators/ }).click();
  const card = page.locator('article', { hasText: 'Джозеф (демо)' });
  await card.getByRole('button', { name: 'Verify' }).click();
  await expect(card.getByRole('alert')).toContainText('Add a reason');
  await card.getByLabel('Reason').fill('15-minute call in Russian: understandable, B1 as stated.');
  await card.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Джозеф (демо)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Verified' }).click();
  await expect(page.locator('article', { hasText: 'Джозеф (демо)' })).toContainText('15-minute call in Russian');
});

test('a moderator gives a stuck translation request to another translator', async ({ page }) => {
  await signIn(page, 'moderator@example.com');
  await page.getByRole('link', { name: /^Translation requests/ }).click();
  const card = page.locator('article', { hasText: 'справку о прививках' });
  await card.getByLabel('Assign to').selectOption({ label: 'Ванджиру (демо) — Kenya' });
  await card.getByRole('button', { name: 'Send offer' }).click();
  await expect(page.getByText('справку о прививках')).toHaveCount(0);
  await page.getByRole('button', { name: 'Waiting for reply' }).click();
  await expect(page.locator('article', { hasText: 'справку о прививках' })).toContainText('Translator: Ванджиру (демо)');
});

test('a content editor adds an insurer to the comparison', async ({ page, request }) => {
  await signIn(page, 'editor@example.com');
  await page.getByRole('link', { name: 'Insurers' }).click();
  await page.getByRole('link', { name: 'New' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Demo Strakhovanie E2E');
  await page.getByLabel('Claims contact').fill('+7 000 999-99-99');
  await page.getByLabel('Repatriation confirmed by the insurer').check();
  await page.getByLabel('Show on the insurance page').check();
  await page.getByLabel('I confirmed claims and repatriation with the insurer today').check();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('link', { name: 'Demo Strakhovanie E2E' })).toBeVisible();
  const pub = await (await request.get(`${process.env.API_URL ?? 'http://localhost:3000'}/public/insurers`)).json();
  expect(pub.map((i: { name: string }) => i.name)).toContain('Demo Strakhovanie E2E');
});

test('a moderator creates and revokes a review invite, with the counts', async ({ page }) => {
  await signIn(page, 'moderator@example.com');
  await page.goto('/operators?q=Savanna');
  await page.getByRole('link', { name: 'Savanna Line Tours (demo)' }).click();
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Review invites' }) });
  await panel.getByLabel('Traveller’s name').fill('Дмитрий');
  await panel.getByLabel('Email or Telegram').fill('dmitry@example.com');
  await panel.getByRole('button', { name: 'Create invite link' }).click();
  await expect(panel.getByLabel('Review link')).toHaveValue(/\/review\/[A-Za-z0-9_-]{43}$/);
  await expect(panel).toContainText(/1\s+sent/);
  await panel.getByRole('button', { name: 'Revoke' }).first().click();
  await expect(panel.locator('.pill').filter({ hasText: 'revoked' })).toBeVisible();
});

test('a moderator invites a traveller who asked through the bot', async ({ page, request }) => {
  await request.delete('http://localhost:8099/__messages');
  await signIn(page, 'moderator@example.com');
  await page.getByRole('link', { name: /^Inquiries/ }).click();
  await page.getByRole('button', { name: 'Answered' }).click();
  const card = page.locator('article', { hasText: 'Есть ли места на февраль для двоих?' });
  await card.getByRole('button', { name: 'Invite to review after the trip' }).click();
  await expect(card.getByLabel('Trip date')).toHaveValue('2027-02-01');
  await card.getByLabel('Trip date').fill('2026-09-20');
  await card.getByRole('button', { name: 'Send invite in Telegram' }).click();
  await expect(card.getByRole('status')).toContainText('Invite sent to the traveller in Telegram');
  const calls = await (await request.get('http://localhost:8099/__messages')).json();
  expect(calls.find((c: { chat_id?: string }) => c.chat_id === '100000001')?.reply_markup.inline_keyboard[0][0].text).toBe('Оставить отзыв');
});
