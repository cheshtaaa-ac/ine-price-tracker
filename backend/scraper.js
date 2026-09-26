const { chromium } = require('playwright');

const MAX_RETRIES = 20;
const WAIT_BETWEEN_MS = 4000;
const MAX_TOTAL_MS = 120000;

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

async function scrapeProduct(itemId, optionLabel, { headed = false } = {}) {
  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  const startTime = Date.now();
  let attempts = 0;
  let outcome = 'failed';
  let price = null;
  let stock = null;

  try {
    await page.goto(`https://demo.inelabteamdev.com/item/${itemId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await dismissCookieBanner(page);

    await page.getByRole('button', { name: optionLabel, exact: true }).click({ force: true });
    await dismissCookieBanner(page);
    await page.waitForTimeout(500);

    const pricePanel = page.locator('.offer-panel');
    const checkBtn = page.getByRole('button', { name: /check today.?s price/i });

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

      const panelText = await pricePanel.innerText().catch(() => '');
      const priceTexts = await page.locator('text=/₹[\\d,]+/').allTextContents().catch(() => []);

      if (priceTexts.length) {
        price = parsePrice(priceTexts[priceTexts.length - 1]);
        const soldOut = await page.getByText(/sold out/i).isVisible().catch(() => false);
        stock = soldOut ? 'Out of Stock' : 'In Stock';
        outcome = attempts === 1 ? 'success' : 'retried';
        console.log(`Succeeded on attempt ${attempts}: price=${price}, stock=${stock}`);
        break;
      }

      if (/challenge_failed/i.test(panelText)) {
        console.log(`Attempt ${attempts}: challenge_failed, clicking retry`);
        const retryBtn = page.getByRole('button', { name: /retry|check again/i });
        if (await retryBtn.isVisible().catch(() => false)) {
          await retryBtn.click({ force: true });
        }
      } else {
        console.log(`Attempt ${attempts}: panel says: "${panelText.slice(0, 60)}"`);
      }
    }

    if (!price) {
      console.log(`Gave up after ${attempts} attempts / ${Date.now() - startTime}ms`);
    }
  } catch (err) {
    console.error('Scrape error:', err.message);
  } finally {
    await browser.close();
  }

  return { itemId, option: optionLabel, price, stock, outcome, attempts, timestamp: new Date().toISOString() };
}

module.exports = { scrapeProduct };