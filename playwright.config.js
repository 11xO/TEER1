import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 30000,
  reporter: 'list',
  use: { ...devices['Pixel 7'], channel: process.env.PLAYWRIGHT_CHANNEL, baseURL: 'http://localhost:5174', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: 'npm run dev -- --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: !process.env.CI },
    { command: 'npm run preview -- --port 4174 --strictPort', url: 'http://localhost:4174', reuseExistingServer: !process.env.CI },
    { command: 'npm run dev -- --port 5175 --strictPort', url: 'http://localhost:5175', env: { VITE_WHATSAPP_VERIFICATION_ENABLED: 'true', VITE_LOCAL_TEST_OTP: 'false' }, reuseExistingServer: !process.env.CI },
  ],
});
