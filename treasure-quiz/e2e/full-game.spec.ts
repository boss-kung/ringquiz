import { test, expect } from './fixtures';

test('Host and Player routes are isolated across browser contexts', async ({ hostPage, playerPage }) => {
  await hostPage.goto('/host');
  await playerPage.goto('/play');
  await expect(hostPage.getByRole('heading', { name: 'Treasure Quiz Host' })).toBeVisible();
  await expect(playerPage.getByRole('heading', { name: 'Treasure Quiz' })).toBeVisible();
  await expect(hostPage.locator('input')).toHaveCount(1);
  await expect(playerPage.locator('input')).toHaveCount(1);
});

test('answer controls keep touch-safe dimensions on a narrow viewport', async ({ playerPage }) => {
  await playerPage.setViewportSize({ width: 320, height: 740 });
  await playerPage.goto('/play');
  const input = playerPage.locator('input').first();
  await expect(input).toHaveJSProperty('disabled', false);
  const box = await input.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
