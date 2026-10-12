import { expect, test } from '@playwright/test';

/** Pilot round: verification state and standing disclaimers on visa and insurance pages. */
test('a checked visa guide shows its date and source; an unchecked one says so', async ({ page }) => {
  await page.goto('/visa/kenya-eta');
  await expect(page.getByText(/Проверено 28 сентября 2026/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'источник: www.etakenya.go.ke' })).toHaveAttribute('href', 'https://www.etakenya.go.ke');
  await expect(page.getByRole('complementary', { name: 'Важно' })).toContainText('Мы не оказываем визовых услуг');

  await page.goto('/visa/tanzania-zanzibar-evisa');
  await expect(page.getByRole('note')).toContainText('Ещё не проверено');
  await expect(page.getByText(/Проверено \d/)).toHaveCount(0);

  await page.goto('/visa');
  const tz = page.getByRole('link', { name: /Танзанию/ });
  await expect(tz).toContainText('Ещё не проверено');
  await expect(page.getByRole('link', { name: /eTA\) в Кению/ })).toContainText('Проверено 28 сентября 2026');
});

test('insurers without a recorded source are marked not yet verified; the page carries the disclaimer', async ({ page }) => {
  await page.goto('/insurance');
  await expect(page.locator('tr', { hasText: 'Демо Страхование В' })).toContainText('Проверено 20 сентября 2026');
  await expect(page.locator('tr', { hasText: 'Демо Страхование Г' })).toContainText('Ещё не проверено');
  await expect(page.getByRole('complementary', { name: 'Важно' })).toContainText('не является рекомендацией');
});
