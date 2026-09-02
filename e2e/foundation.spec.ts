import { expect, test } from '@playwright/test';
test('library, settings, connection and saved theme work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ваша кулинарная тетрадь' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Настройки' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки тетради' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Соединение проверено');
  await expect(page.getByText('Локальный режим:', { exact: false })).toBeVisible();
  const theme = page.getByRole('button', { name: 'Темная тема' });
  const before = await theme.getAttribute('aria-pressed');
  await theme.click();
  await expect(theme).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  await page.reload();
  await expect(theme).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  await page.getByRole('button', { name: 'Проверить снова' }).click();
  await expect(page.getByRole('status')).toHaveText('Соединение проверено');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
test('unknown route has a way back', async ({ page }) => {
  await page.goto('/#/missing');
  await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
  await page.getByRole('link', { name: 'Вернуться в библиотеку' }).click();
  await expect(page.getByRole('heading', { name: 'Ваша кулинарная тетрадь' })).toBeVisible();
});
test('main content is reachable by keyboard', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Перейти к содержанию' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});
