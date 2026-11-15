import { defineConfig, devices } from '@playwright/test';

const isCi = process.env.CI !== undefined;

// Optional override for machines where Playwright's own browser download is
// unavailable: point this at any Chromium/Chrome binary.
const chromiumPath = process.env.PW_CHROMIUM_PATH;

// Headless machines usually have no GPU. These flags make Chromium use its
// software rasteriser (SwiftShader) so WebGL2 still works in tests.
const launchOptions = {
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  ...(chromiumPath !== undefined && chromiumPath !== '' ? { executablePath: chromiumPath } : {}),
};

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  reporter: isCi ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], launchOptions },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], launchOptions },
    },
  ],
  webServer: {
    // Tests run against the production build, not the dev server, so that they
    // exercise exactly what gets deployed.
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !isCi,
    timeout: 120_000,
  },
});
