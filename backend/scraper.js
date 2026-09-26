const { chromium } = require('playwright');

const MAX_RETRIES = 12;
const WAIT_BETWEEN_MS = 4000;
const MAX_TOTAL_MS = 120000;
const MAX_STORED_FAILURES = 20;

// In-memory ring buffer of recent failures so you can inspect what actually
// happened without re-running a live scrape. Cleared on redeploy/restart -
// good enough for debugging, not meant as permanent storage.
const recentFailures = [];

function recordFailure(entry) {
  recentFailures.push(entry);
  if (recentFailures.length > MAX_STORED_FAILURES) recentFailures.shift();
}

function getRecentFailures() {
  return recentFailures;
}

function parsePrice(text) {
  const match = text.match(/₹([\d,]+)/);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

async function dismissCookieBanner(page) {
  for (let i = 0; i < 5; i++) {
    const allowBtn = page.getByRole('button', { name: 'ALLOW' });
    const visible = await allowBtn.isVisible().catch(() => false);
    if (!visible) return;
    await allowBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function captureFailureScreenshot(pricePanel, page) {
  try {
    return (await pricePanel.screenshot({ type: 'jpeg', quality: 40 })).toString('base64');
  } catch {
    try {
      return (await page.screenshot({ type: 'jpeg', quality: 40 })).toString('base64');
    } catch {
      return null;
    }
  }
}

async function scrapeProduct(itemId, optionLabel, { headed = false } = {}) {
  const browser = await chromium.launch({
    headless: !headed,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote'
    ]
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Ground truth from the wire, independent of the DOM text (which can lag
  // behind the real response by a beat). Filtered to XHR/fetch calls whose
  // URL looks relevant, so this doesn't balloon into logging every asset.
  const networkLog = [];
  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!/quote|price|offer|challenge/i.test(url)) return;
      const resourceType = response.request().resourceType();
      if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
      let bodySnippet = '';
      try {
        bodySnippet = (await response.text()).slice(0, 300);
      } catch {
        // binary/encrypted body, or already consumed - skip
      }
      networkLog.push({ url, status: response.status(), bodySnippet, atMs: Date.now() });
    } catch {
      // response object can go stale (navigation, redirect) - ignore
    }
  });

  const startTime = Date.now();
  let attempts = 0;
  let outcome = 'failed';
  let price = null;
  let stock = null;
  let lastPanelText = '';

  try {
    await page.goto(`https://demo.inelabteamdev.com/item/${itemId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await dismissCookieBanner(page);

    await page.getByRole('button', { name: optionLabel, exact: true }).click({ force: true });
    await dismissCookieBanner(page);
    await page.waitForTimeout(500);

    const pricePanel = page.locator('.offer-panel');
    const checkBtn = page.getByRole('button', { name: /check today.?s price/i });
    // Scoped to the panel - matching ₹ text anywhere on the page can pick up
    // an unrelated figure (nav, a strikethrough MRP, a "similar products" rail)
    // and silently record it as a correct price.
    const priceInPanel = pricePanel.locator('text=/₹[\\d,]+/');

    for (let i = 0; i < 15; i++) {
      await dismissCookieBanner(page);
      await pricePanel.hover({ force: true }).catch(() => {});
      const disabledAttr = await checkBtn.getAttribute('disabled').catch(() => 'ERR');
      if (disabledAttr === null) break;
      await page.waitForTimeout(500);
    }

    await dismissCookieBanner(page);
    await checkBtn.click({ timeout: 10000, force: true });

    while (attempts < MAX_RETRIES && (Date.now() - startTime) < MAX_TOTAL_MS) {
      attempts++;
      await page.waitForTimeout(WAIT_BETWEEN_MS);
      await dismissCookieBanner(page);

      lastPanelText = await pricePanel.innerText().catch(() => '');
      const priceTexts = await priceInPanel.allTextContents().catch(() => []);

      if (priceTexts.length) {
        price = parsePrice(priceTexts[priceTexts.length - 1]);
        const soldOut = await page.getByText(/sold out/i).isVisible().catch(() => false);
        stock = soldOut ? 'Out of Stock' : 'In Stock';
        outcome = attempts === 1 ? 'success' : 'retried';
        console.log(`Succeeded on attempt ${attempts}: price=${price}, stock=${stock}`);
        break;
      }

      if (/challenge_failed/i.test(lastPanelText)) {
        console.log(`Attempt ${attempts}: challenge_failed, retrying`);
        const retryBtn = page.getByRole('button', { name: /retry|check again/i });
        // Same rule as the first check button: it only responds after a
        // hover. Clicking it cold was a silent no-op in every retry after
        // the first failure - this was quietly capping us at 1 real attempt.
        await pricePanel.hover({ force: true }).catch(() => {});
        if (await retryBtn.isVisible().catch(() => false)) {
          await retryBtn.click({ force: true });
        }
      } else {
        console.log(`Attempt ${attempts}: panel says: "${lastPanelText.slice(0, 60)}"`);
      }
    }

    if (!price) {
      console.log(`Gave up after ${attempts} attempts / ${Date.now() - startTime}ms`);
      recordFailure({
        itemId,
        optionLabel,
        timestamp: new Date().toISOString(),
        attempts,
        panelText: lastPanelText,
        networkLog,
        screenshot: await captureFailureScreenshot(pricePanel, page),
      });
    }
  } catch (err) {
    console.error('Scrape error:', err.message);
    recordFailure({
      itemId,
      optionLabel,
      timestamp: new Date().toISOString(),
      attempts,
      panelText: lastPanelText,
      networkLog,
      error: err.message,
    });
  } finally {
    await browser.close();
  }

  return { itemId, option: optionLabel, price, stock, outcome, attempts, timestamp: new Date().toISOString() };
}

module.exports = { scrapeProduct, getRecentFailures };
