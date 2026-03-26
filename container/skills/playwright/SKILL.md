---
name: playwright
description: Use Playwright for deterministic browser automation, DOM inspection, assertions, and repeatable UI testing. Prefer it when agent-browser is too limited or when the user wants robust end-to-end verification.
allowed-tools: Bash(node:*), Bash(npx:*), Bash(playwright:*)
---

# Playwright Browser Automation

Use Playwright when you need stronger browser control than `agent-browser` provides.

Prefer Playwright for:
- multi-step end-to-end app flows
- DOM assertions and repeatable verification
- scripted screenshots after state setup
- cases where you need JavaScript in the page context
- reliable interaction with dynamic SPAs

## Runtime notes

- Chromium is already installed in the container at `/usr/bin/chromium`.
- Playwright is installed globally.
- From inside the agent sandbox, host services are usually reachable at `http://host.docker.internal:<port>`.
- For the NanoClaw Web UI, use `http://host.docker.internal:3000`.

## Quick checks

```bash
playwright --version
node -e "const { chromium } = require('playwright'); console.log(typeof chromium.launch)"
```

## Fast one-off script pattern

```bash
node <<'EOF'
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
  });
  const page = await browser.newPage();
  await page.goto('http://host.docker.internal:3000', { waitUntil: 'networkidle' });
  console.log(await page.title());
  await page.screenshot({ path: '/workspace/group/playwright-shot.png', fullPage: true });
  await browser.close();
})();
EOF
```

## Common workflows

### Capture a screenshot

```bash
node <<'EOF'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://host.docker.internal:3000', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/workspace/group/ui.png', fullPage: true });
  await browser.close();
})();
EOF
```

### Assert visible text

```bash
node <<'EOF'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
  const page = await browser.newPage();
  await page.goto('http://host.docker.internal:3000', { waitUntil: 'networkidle' });
  const text = await page.locator('body').innerText();
  console.log(text.includes('NanoClaw') ? 'found' : 'missing');
  await browser.close();
})();
EOF
```

### Interact with the UI

```bash
node <<'EOF'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
  const page = await browser.newPage();
  await page.goto('http://host.docker.internal:3000', { waitUntil: 'networkidle' });
  await page.fill('#message-input', 'Playwright test message');
  await page.click('#send-btn');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/workspace/group/after-send.png', fullPage: true });
  await browser.close();
})();
EOF
```

## Guidance

- Use `agent-browser` for quick exploratory browsing.
- Use Playwright when the task needs determinism, scripting, or repeatability.
- Save screenshots and artifacts into `/workspace/group/` so they persist.
- If a user asks you to inspect the live Web UI, prefer `http://host.docker.internal:3000` from inside the sandbox.
