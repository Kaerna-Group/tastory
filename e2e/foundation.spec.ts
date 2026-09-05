import { expect, test } from '@playwright/test';
test('library, settings, checks and saved theme builder work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ваша кулинарная тетрадь' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Настройки' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки тетради' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ваш аккаунт' })).toBeVisible();
  await expect(page.getByText('Вход Google ещё настраивается.', { exact: false })).toBeVisible();
  const builder = page.getByRole('region', { name: 'Внешний вид' });
  await expect(builder.getByRole('button', { name: 'Подробные настройки' })).toBeVisible();
  await expect(builder.getByRole('heading', { name: 'Читаемость текста' })).toHaveCount(0);
  await builder.getByRole('button', { name: 'Подробные настройки' }).click();
  await builder.getByRole('button', { name: 'Выбрать тему Гербарий' }).click();
  await builder.getByRole('button', { name: 'Цвет деталей: Лавандовый' }).click();
  await builder.getByRole('button', { name: /^Современно/ }).click();
  await builder.getByRole('button', { name: 'Дополнительные действия с темой' }).click();
  await builder.getByRole('menuitem', { name: /Создать копию/ }).click();
  await expect(builder.getByLabel('Название оформления')).toHaveValue('Гербарий — копия');
  await builder.getByRole('button', { name: 'Дополнительные действия с темой' }).click();
  await builder.getByRole('menuitem', { name: /Точные настройки/ }).click();
  await expect(builder.getByRole('heading', { name: 'Читаемость текста' })).toBeVisible();
  await builder.locator('.theme-colors input[type="color"]').nth(2).fill('#eef0e7');
  await expect(builder.getByRole('button', { name: 'Применить оформление' })).toBeDisabled();
  await expect(builder.getByRole('alert')).toContainText('плохо читаются');
  await builder.getByRole('button', { name: 'Выбрать тему Гербарий' }).click();
  await builder.getByRole('button', { name: 'Дополнительные действия с темой' }).click();
  await builder.getByRole('menuitem', { name: /Создать копию/ }).click();
  await builder.getByRole('button', { name: 'Применить оформление' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-app-paper', 'linen');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-app-paper', 'linen');
  await builder.getByRole('button', { name: 'Подробные настройки' }).click();
  await expect(builder.getByLabel('Название оформления')).toHaveValue('Гербарий — копия');
  await builder.getByRole('button', { name: 'Открыть библиотеку тем' }).click();
  const themeLibrary = page.getByRole('dialog', { name: 'Библиотека тем' });
  await expect(themeLibrary.getByRole('heading', { name: 'Дополнительные темы' })).toBeVisible();
  await expect(themeLibrary.getByRole('heading', { name: 'Мои темы' })).toBeVisible();
  await expect(themeLibrary.getByText('Гербарий — копия', { exact: true })).toBeVisible();
  await themeLibrary.getByRole('button', { name: 'Закрыть библиотеку тем' }).click();
  await builder
    .getByRole('button', { name: 'Новые страницы Основа при следующем выборе макета' })
    .click();
  await builder.getByRole('button', { name: 'Выбрать тему Полуночные чернила' }).click();
  await builder.getByRole('button', { name: 'Дополнительные действия с темой' }).click();
  await builder.getByRole('menuitem', { name: /Создать копию/ }).click();
  await builder.getByRole('button', { name: 'Оформить страницы рецептов' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Проверки' }).click();
  await expect(page.getByRole('heading', { name: 'Проверки тетради' })).toBeVisible();
  await expect(page.getByText('Локальный режим:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Проверить снова' }).click();
  await expect(page.locator('.connection-status')).toHaveText('Соединение проверено');
  await expect(page.getByText('Хранение рецептов пока не подключено')).toHaveCount(0);
  await page.goto('/#/drafts/00000000-0000-4000-8000-000000000001');
  await expect(page.locator('.recipe-page-shell')).not.toHaveAttribute('data-paper');
  await expect(page.locator('html')).toHaveAttribute('data-app-paper', 'linen');
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
test('the PWA invitation is dismissible and the app shell works offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const prompt = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted'; platform: string }>;
    };
    prompt.prompt = async () => undefined;
    prompt.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    window.dispatchEvent(prompt);
  });
  const invitation = page.getByRole('complementary', { name: 'Установка Tastory' });
  await expect(invitation).toBeVisible();
  await invitation.getByRole('button', { name: 'Закрыть приглашение установить Tastory' }).click();
  await expect(invitation).toHaveCount(0);
  await page.reload();
  await expect(invitation).toHaveCount(0);

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const cacheInspection = await page.evaluate(async () => {
    const source = document.querySelector<HTMLScriptElement>('script[type="module"]')?.src ?? '';
    const response = await caches.match(source, { ignoreVary: true });
    return {
      source,
      cacheNames: await caches.keys(),
      cachedStatus: response?.status ?? 0,
      cachedBytes: response ? (await response.clone().arrayBuffer()).byteLength : 0,
      controller: navigator.serviceWorker.controller?.scriptURL ?? '',
    };
  });
  expect(cacheInspection.cacheNames.some((name) => name.startsWith('tastory-app-'))).toBe(true);
  expect(cacheInspection.cachedStatus).toBe(200);
  expect(cacheInspection.cachedBytes).toBeGreaterThan(0);
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Ваша кулинарная тетрадь' })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('help traps focus and restores it to the trigger', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Справка' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Как работать с Tastory' });
  await expect(dialog.getByRole('button', { name: 'Закрыть справку' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Закрыть справку' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
