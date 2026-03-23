const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    timeout: 60000,
    use: {
        baseURL: 'http://localhost:3333',
        headless: false, // Show browsers so you can see what's happening
        video: 'retain-on-failure',
    },
    webServer: {
        command: 'python3 docs/serve.py 3333',
        port: 3333,
        reuseExistingServer: true,
    },
});
