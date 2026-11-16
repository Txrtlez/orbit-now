import { defineConfig, devices } from '@playwright/test';

const isCi = process.env.CI !== undefined;

// Optional override for machines where Playwright's own browser download is
// unavailable: point this at any Chromium/Chrome binary.
/**
 * Set CROSS_BROWSER=1 to run the tests in Firefox and WebKit instead of
 * Chromium. They are a separate run because those browsers have to be
 * downloaded and because a failure there is recorded, not allowed to stop a
 * deployment (the `cross-browser` workflow).
 */
const crossBrowser = process.env.CROSS_BROWSER === '1';

const chromiumPath = process.env.PW_CHROMIUM_PATH;

// Headless machines usually have no GPU. These flags make Chromium use its
// software rasteriser (SwiftShader) so WebGL2 still works in tests.
const launchOptions = {
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  ...(chromiumPath !== undefined && chromiumPath !== '' ? { executablePath: chromiumPath } : {}),
};

/** Browser storage as it is after the tour has been seen once. */
export const RETURNING_VISITOR = {
  cookies: [],
  origins: [
    {
      origin: 'http://localhost:4173',
      localStorage: [{ name: 'orbit-now:tour', value: 'seen' }],
    },
  ],
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
    // A first visit starts the guided tour. Every test but the tour's own
    // begins as a returning visitor, so that the tour is not in its way.
    storageState: RETURNING_VISITOR,
  },
  projects: crossBrowser
    ? [
        // The engines behind Firefox and Safari. Playwright's WebKit is the
        // same engine as Safari's but is not Safari itself, and none of
        // these is a real phone. See VALIDATION.md, V7.4.
        {
          name: 'firefox',
          use: {
            ...devices['Desktop Firefox'],
            // A test machine has no graphics card; ask Firefox to draw WebGL in software.
            launchOptions: {
              firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false },
            },
          },
        },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        { name: 'mobile-webkit', use: { ...devices['iPhone 14'] } },
      ]
    : [
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
