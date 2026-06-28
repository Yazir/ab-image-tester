import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:3000',
    headless: false,
  },
  webServer: {
    command: 'npx tsx src/server/dev.ts',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
