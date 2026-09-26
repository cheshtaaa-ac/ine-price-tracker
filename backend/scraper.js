const { chromium } = require('playwright');

// The 200-handshake-then-401 gap in captured failures ranged from ~0.8s to
// ~14.5s with no consistent pattern - this isn't a timing race we can win by
// tuning wait time, it's the site rejecting the challenge answer outright on
// an inconsistent basis (by the assignment's own description). Since each
// attempt looks like an independent roll, more attempts per scrape genuinely
// raises the odds of landing a success before giving up - that's the one
// real lever here. Raised from 12/120s; keep this modest relative to the
// 2-hour schedule since scrape-all runs every tracked product in sequence.
const MAX_RETRIES = 20;
const WAIT_BETWEEN_MS = 4000;
const MAX_TOTAL_MS = 180000;
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

// The first check button needed a settle-then-poll before it was safe to
// click - a hover alone didn't make it clickable immediately. There's no
// reason to assume the retry button is different, so both go through this
// same wait-until-enabled step instead of one being polled and the other
// clicked blind right after a single hover.
async function waitThenClick(page, pricePanel, button, { maxPolls = 15, pollMs = 500 } = {}) {
  for (let i = 0; i < maxPolls; i++) {
    await dismissCookieBanner(page);
    await pricePanel.hover({ force: true }).catch(() => {});
    const disabledAttr = await button.getAttribute('disabled').catch(() => 'ERR');
    if (disabledAttr === null) break;
    await page.waitForTimeout(pollMs);
  }
  await dismissCookieBanner(page);
  const visible = await button.isVisible().catch(() => false);
  if (!visible) return false;
  await button.click({ force: true }).catch(() => {});
  return true;
}

async function captureFailureScreenshot(page) {
  try {
    return (await page.screenshot({ type: 'jpeg', quality: 40, fullPage: true })).toString('base64');
  } catch {
    return null;
  }
}

async function scrapeProduct(itemId, optionLabel, { headed = false } = {}) {
  const lowMemory = process.env.LOW_MEMORY_MODE !== 'false';
  const baseArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
  const args = lowMemory ? [...baseArgs, '--single-process', '--no-zygote'] : baseArgs;

  const browser = await chromium.launch({ headless: !headed, args });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Ground truth from the wire. Deliberately NOT filtered by URL keyword this
  // time - the last run showed zero matches for quote|price|offer|challenge
  // even though the panel clearly cycled through real state changes, which
  // means that filter was hiding the real request from us, not skipping
  // noise. Capped by length instead, so we still see everything relevant.
  const MAX_NETWORK_LOG = 60;
  const networkLog = [];
  const wsLog = [];

  page.on('response', async (response) => {
    try {
      const resourceType = response.request().resourceType();
      if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
      let bodySnippet = '';
      try {
        bodySnippet = (await response.text()).slice(0, 300);
      } catch {
        // binary/encrypted body, or already consumed - skip
      }
      networkLog.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        bodySnippet,
        atMs: Date.now(),
      });
      if (networkLog.length > MAX_NETWORK_LOG) networkLog.shift();
    } catch {
      // response object can go stale (navigation, redirect) - ignore
    }
  });

  // If the challenge actually resolves over a WebSocket instead of HTTP,
  // the listener above would never see it. Cheap to check directly instead
  // of arguing about it - if wsLog stays empty too, that theory is dead.
  page.on('websocket', (ws) => {
    wsLog.push({ url: ws.url(), atMs: Date.now(), direction: 'opened' });
    ws.on('framereceived', (frame) => {
      wsLog.push({ direction: 'received', atMs: Date.now(), payload: String(frame.payload).slice(0, 200) });
      if (wsLog.length > MAX_NETWORK_LOG) wsLog.shift();
    });
    ws.on('framesent', (frame) => {
      wsLog.push({ direction: 'sent', atMs: Date.now(), payload: String(frame.payload).slice(0, 200) });
      if (wsLog.length > MAX_NETWORK_LOG) wsLog.shift();
    });
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
    const priceInPanel = pricePanel.locator('text=/₹[\\d,]+/');
    // Fallback only - matching anywhere on the page risks picking up an
    // unrelated ₹ figure (nav, MRP strike-through, "similar products"), so
    // this is a second choice, used only when the panel itself has nothing
    // and logged distinctly so a page-wide match can be told apart later.
    const priceOnPage = page.locator('text=/₹[\\d,]+/');

    await waitThenClick(page, pricePanel, checkBtn);

    while (attempts < MAX_RETRIES && (Date.now() - startTime) < MAX_TOTAL_MS) {
      attempts++;
      await page.waitForTimeout(WAIT_BETWEEN_MS);
      await dismissCookieBanner(page);

      lastPanelText = await pricePanel.innerText().catch(() => '');
      let priceTexts = await priceInPanel.allTextContents().catch(() => []);
      let priceSource = 'panel';
      if (!priceTexts.length) {
        priceTexts = await priceOnPage.allTextContents().catch(() => []);
        priceSource = 'page-wide-fallback';
      }

      if (priceTexts.length) {
        price = parsePrice(priceTexts[priceTexts.length - 1]);
        const soldOut = await page.getByText(/sold out/i).isVisible().catch(() => false);
        stock = soldOut ? 'Out of Stock' : 'In Stock';
        outcome = attempts === 1 ? 'success' : 'retried';
        console.log(`Succeeded on attempt ${attempts} (source: ${priceSource}): price=${price}, stock=${stock}`);
        break;
      }

      if (/challenge_failed/i.test(lastPanelText)) {
        console.log(`Attempt ${attempts}: challenge_failed, retrying`);
        const retryBtn = page.getByRole('button', { name: /retry|check again/i });
        const clicked = await waitThenClick(page, pricePanel, retryBtn);
        if (!clicked) console.log(`Attempt ${attempts}: retry button never became visible/enabled`);
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
        wsLog,
        screenshot: await captureFailureScreenshot(page),
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
      wsLog,
      error: err.message,
    });
  } finally {
    await browser.close();
  }

  return { itemId, option: optionLabel, price, stock, outcome, attempts, timestamp: new Date().toISOString() };
}

module.exports = { scrapeProduct, getRecentFailures };
