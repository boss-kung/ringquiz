import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ hostPage: import('@playwright/test').Page; playerPage: import('@playwright/test').Page }>({
  hostPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  playerPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
