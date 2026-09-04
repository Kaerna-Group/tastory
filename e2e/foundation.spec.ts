import { expect, test } from '@playwright/test';
test('library, settings, connection and saved theme builder work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ваша кулинарная тетрадь' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Настройки' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки тетради' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ваш аккаунт' })).toBeVisible();
  await expect(page.getByText('Вход Google ещё настраивается.', { exact: false })).toBeVisible();
  await expect(page.locator('.connection-status')).toHaveText('Соединение проверено');
  await expect(page.getByText('Локальный режим:', { exact: false })).toBeVisible();
  const builder = page.getByRole('region', { name: 'Конструктор тем' });
  await expect(builder.getByText('AA пройден')).toBeVisible();
  await builder.getByLabel('Встроенная тема').selectOption('herbarium');
  await builder.getByRole('button', { name: 'Создать копию' }).click();
  await expect(builder.getByLabel('Название')).toHaveValue('Гербарий — копия');
  await builder.locator('input[type="color"]').nth(2).fill('#eef0e7');
  await expect(builder.getByRole('button', { name: 'Применить к приложению' })).toBeDisabled();
  await expect(builder.getByRole('alert')).toContainText('контраст не ниже 4.5:1');
  await builder.getByRole('button', { name: 'Создать копию' }).click();
  await builder.getByRole('button', { name: 'Применить к приложению' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-app-paper', 'linen');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-app-paper', 'linen');
  await expect(builder.getByLabel('Название')).toHaveValue('Гербарий — копия');
  await builder
    .getByRole('button', { name: 'Страница рецепта Бумага и карточки открытого рецепта' })
    .click();
  await builder.getByLabel('Встроенная тема').selectOption('midnight');
  await builder.getByRole('button', { name: 'Создать копию' }).click();
  await builder.getByRole('button', { name: 'Применить к страницам' }).click();
  await page.getByRole('button', { name: 'Проверить снова' }).click();
  await expect(page.locator('.connection-status')).toHaveText('Соединение проверено');
  await page.goto('/#/drafts/00000000-0000-4000-8000-000000000001');
  await expect(page.locator('.recipe-page-theme')).toHaveAttribute('data-paper', 'grid');
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
