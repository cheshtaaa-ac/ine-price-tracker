const { chromium } = require('playwright');

// Retry settings
const MAX_RETRIES = 12;
const MAX_TOTAL_MS = 180000;

// Wait up to this long for one challenge attempt to finish.
const ATTEMPT_WAIT_MS = 30000;

// Short polling interval while the panel is loading.
const POLL_MS = 500;

// After this many failures, reload the page to reset client-side state.
const RELOAD_AFTER_FAILURES = 3;

const MAX_STORED_FAILURES = 20;
const recentFailures = [];

function recordFailure(entry) {
  recentFailures.push(entry);

  if (recentFailures.length > MAX_STORED_FAILURES) {
    recentFailures.shift();
  }
}

function getRecentFailures() {
  return recentFailures;
}

function parsePrice(text) {
  // Handles ₹1,234 and ₹ 1,234 and ₹1,234.50
  const match = text.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);

  if (!match) return null;

  return Number(match[1].replace(/,/g, ''));
}

async function dismissCookieBanner(page) {
  for (let i = 0; i < 5; i++) {
    const allowBtn = page.getByRole('button', { name: 'ALLOW' });

    const visible = await allowBtn.isVisible().catch(() => false);

    if (!visible) return;

    try {
      await allowBtn.click({ force: true });
    } catch (err) {
      console.log('Cookie button click failed:', err.message);
    }

    await page.waitForTimeout(300);
  }
}

async function hoverPricePanel(page, pricePanel) {
  await dismissCookieBanner(page);

  await pricePanel.scrollIntoViewIfNeeded().catch(() => {});

  const box = await pricePanel.boundingBox().catch(() => null);

  if (!box) {
    throw new Error('Price panel has no bounding box');
  }

  // Real mouse movement rather than only relying on locator.hover().
  await page.mouse.move(0, 0);
  await page.waitForTimeout(100);

  await page.mouse.move(
    box.x + Math.max(5, box.width * 0.2),
    box.y + Math.max(5, box.height * 0.2)
  );

  await page.waitForTimeout(200);

  await page.mouse.move(
    box.x + box.width / 2,
    box.y + box.height / 2
  );

  await page.waitForTimeout(300);
}

async function clickPriceButton(page, pricePanel, checkBtn) {
  await hoverPricePanel(page, pricePanel);

  const visible = await checkBtn.isVisible().catch(() => false);

  if (!visible) {
    throw new Error('Check-price button is not visible');
  }

  // Wait for actual enabled state.
  for (let i = 0; i < 20; i++) {
    await dismissCookieBanner(page);

    if (await checkBtn.isEnabled().catch(() => false)) {
      await checkBtn.click({ force: true });
      return true;
    }

    await hoverPricePanel(page, pricePanel).catch(() => {});
    await page.waitForTimeout(300);
  }

  throw new Error('Check-price button never became enabled');
}

async function getPanelState(page, pricePanel) {
  const panelText = await pricePanel.innerText().catch(() => '');

  console.log('FULL PANEL HTML:', (await pricePanel.innerHTML()).slice(0, 10000));

    const priceElements = await pricePanel
    .locator('text=/₹\\s*[\\d,]+(?:\\.\\d{1,2})?/')
    .all();

  for (let i = 0; i < priceElements.length; i++) {
    try {
      console.log(`PRICE ${i + 1}:`);
      console.log('TEXT:', await priceElements[i].innerText());
      console.log(
        'TAG:',
        await priceElements[i].evaluate(el => el.tagName)
      );
      console.log(
        'CLASS:',
        await priceElements[i].evaluate(el => el.className)
      );
      console.log(
        'HTML:',
        (await priceElements[i].evaluate(el => el.outerHTML)).slice(0, 1000)
      );
    } catch {}
  }

  const priceTexts = await pricePanel
    .locator('text=/₹\\s*[\\d,]+(?:\\.\\d{1,2})?/')
    .allTextContents()
    .catch(() => []);

  if (priceTexts.length) {
      console.log('ALL PRICE TEXTS FOUND:', priceTexts);

  const price = parsePrice(priceTexts[priceTexts.length - 1]);

    if (price !== null) {
      return {
        type: 'success',
        price,
        panelText
      };
    }
  }

  if (/challenge_failed/i.test(panelText)) {
    return {
      type: 'challenge_failed',
      panelText
    };
  }

  if (/upstream\s*429/i.test(panelText)) {
    return {
      type: 'rate_limited',
      panelText
    };
  }

  if (/couldn.?t load the price/i.test(panelText)) {
    return {
      type: 'failed',
      panelText
    };
  }

  if (/loading current price|retrying/i.test(panelText)) {
    return {
      type: 'loading',
      panelText
    };
  }

  return {
    type: 'unknown',
    panelText
  };
}

async function waitForPrice(page, pricePanel) {
  const deadline = Date.now() + ATTEMPT_WAIT_MS;

  let lastText = '';

  while (Date.now() < deadline) {
    await dismissCookieBanner(page);

    const state = await getPanelState(page, pricePanel);

    lastText = state.panelText;

    if (state.type === 'success') {
      return state;
    }

    if (
      state.type === 'challenge_failed' ||
      state.type === 'rate_limited' ||
      state.type === 'failed'
    ) {
      return state;
    }

    // Loading/unknown are NOT failures yet.
    await page.waitForTimeout(POLL_MS);
  }

  return {
    type: 'timeout',
    panelText: lastText
  };
}

async function clickRetry(page, pricePanel) {
  await dismissCookieBanner(page);

  await hoverPricePanel(page, pricePanel).catch(() => {});

  const retryBtn = page.getByRole('button', {
    name: /retry|check again/i
  });

  const visible = await retryBtn.isVisible().catch(() => false);

  if (!visible) {
    return false;
  }

  const enabled = await retryBtn.isEnabled().catch(() => false);

  if (!enabled) {
    return false;
  }

  await retryBtn.click({ force: true });

  return true;
}

async function captureFailureScreenshot(page) {
  try {
    return (
      await page.screenshot({
        type: 'jpeg',
        quality: 40,
        fullPage: true
      })
    ).toString('base64');
  } catch {
    return null;
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

  // Full diagnostic network logging.
  const networkLog = [];
  const MAX_NETWORK_LOG = 150;

  page.on('request', request => {
    try {
      networkLog.push({
        type: 'request',
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
        atMs: Date.now()
      });

      if (networkLog.length > MAX_NETWORK_LOG) {
        networkLog.shift();
      }
    } catch {}
  });

  page.on('response', async response => {
    try {
      const request = response.request();

      let bodySnippet = '';

      // Only read small textual responses.
      if (
        request.resourceType() === 'xhr' ||
        request.resourceType() === 'fetch'
      ) {
        try {
          bodySnippet = (await response.text()).slice(0, 500);
        } catch {}
      }

      networkLog.push({
        type: 'response',
        method: request.method(),
        resourceType: request.resourceType(),
        status: response.status(),
        url: response.url(),
        bodySnippet,
        atMs: Date.now()
      });

      if (networkLog.length > MAX_NETWORK_LOG) {
        networkLog.shift();
      }
    } catch {}
  });

  const startTime = Date.now();

  let attempts = 0;
  let challengeFailures = 0;

  let outcome = 'failed';
  let price = null;
  let stock = null;

  let lastPanelText = '';

  try {
    await page.goto(
      `https://demo.inelabteamdev.com/item/${itemId}`,
      {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      }
    );

    await page.waitForTimeout(1500);

    await dismissCookieBanner(page);

    // Select requested option.
    const optionButton = page.getByRole('button', {
      name: optionLabel,
      exact: true
    });

    await optionButton.click({ force: true });

    await dismissCookieBanner(page);

    await page.waitForTimeout(500);

    const pricePanel = page.locator('.offer-panel');

    const checkBtn = page.getByRole('button', {
      name: /check today.?s price/i
    });

    // Trigger the first challenge.
    await clickPriceButton(
      page,
      pricePanel,
      checkBtn
    );

    while (
      attempts < MAX_RETRIES &&
      Date.now() - startTime < MAX_TOTAL_MS
    ) {
      attempts++;

      const state = await waitForPrice(
        page,
        pricePanel
      );

      lastPanelText = state.panelText || '';

      console.log(
        `Attempt ${attempts}: ${state.type} | ${lastPanelText.slice(0, 180)}`
      );

      // SUCCESS
      if (state.type === 'success') {
        price = state.price;

        const soldOut = await page
          .getByText(/sold out/i)
          .isVisible()
          .catch(() => false);

        stock = soldOut
          ? 'Out of Stock'
          : 'In Stock';

        outcome =
          attempts === 1
            ? 'success'
            : 'retried';

        console.log(
          `SUCCESS: price=${price}, stock=${stock}, attempts=${attempts}`
        );

        break;
      }

      // RATE LIMIT
      if (state.type === 'rate_limited') {
        console.log(
          `429 detected on attempt ${attempts}. Applying backoff.`
        );

        // Do NOT hammer the same endpoint after 429.
        const backoffMs = Math.min(
          30000,
          5000 * Math.pow(2, Math.min(attempts - 1, 3))
        );

        await page.waitForTimeout(backoffMs);
      } else if (
        state.type === 'challenge_failed'
      ) {
        challengeFailures++;

        console.log(
          `Challenge failed (${challengeFailures}).`
        );

        await page.waitForTimeout(1000);
      } else if (state.type === 'timeout') {
        console.log(
          `Price still loading after ${ATTEMPT_WAIT_MS}ms.`
        );

        await page.waitForTimeout(1000);
      }

      // Reset browser-side challenge state periodically.
      if (
        challengeFailures > 0 &&
        challengeFailures % RELOAD_AFTER_FAILURES === 0
      ) {
        console.log(
          'Reloading page to reset challenge state...'
        );

        await page.reload({
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });

        await page.waitForTimeout(1500);

        await dismissCookieBanner(page);

        await page
          .getByRole('button', {
            name: optionLabel,
            exact: true
          })
          .click({ force: true });

        await dismissCookieBanner(page);

        await page.waitForTimeout(500);

        await clickPriceButton(
          page,
          pricePanel,
          checkBtn
        );
      } else {
        // Regular retry.
        const clicked = await clickRetry(
          page,
          pricePanel
        );

        if (!clicked) {
          // Sometimes the page may expose the check button again.
          const checkVisible = await checkBtn
            .isVisible()
            .catch(() => false);

          if (checkVisible) {
            try {
              await clickPriceButton(
                page,
                pricePanel,
                checkBtn
              );
            } catch (err) {
              console.log(
                'Could not re-trigger price challenge:',
                err.message
              );
            }
          }
        }
      }
    }

    if (price === null) {
      console.log(
        `FAILED: no price after ${attempts} attempts / ${
          Date.now() - startTime
        }ms`
      );

      recordFailure({
        itemId,
        optionLabel,
        timestamp: new Date().toISOString(),
        attempts,
        panelText: lastPanelText,
        networkLog,
        screenshot:
          await captureFailureScreenshot(page)
      });
    }
  } catch (err) {
    console.error(
      'Scrape error:',
      err.message
    );

    recordFailure({
      itemId,
      optionLabel,
      timestamp: new Date().toISOString(),
      attempts,
      panelText: lastPanelText,
      networkLog,
      error: err.message
    });
  } finally {
    await browser.close();
  }

  return {
    itemId,
    option: optionLabel,
    price,
    stock,
    outcome,
    attempts,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  scrapeProduct,
  getRecentFailures
};