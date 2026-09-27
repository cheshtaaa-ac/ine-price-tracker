const { chromium } = require('playwright');

// Retry settings
const MAX_RETRIES = 12;
const MAX_TOTAL_MS = 180000;
const ATTEMPT_WAIT_MS = 30000;
const POLL_MS = 500;
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
  const clean = text.replace(/[\u200B-\u200D\uFEFF]/g, '');

  const match = clean.match(
    /₹\s*([\d,]+(?:\.\d{1,2})?)/
  );

  if (!match) return null;

  return Number(match[1].replace(/,/g, ''));
}

async function dismissCookieBanner(page) {
  for (let i = 0; i < 5; i++) {
    const allowBtn = page.getByRole('button', {
      name: 'ALLOW'
    });

    const visible = await allowBtn
      .isVisible()
      .catch(() => false);

    if (!visible) return;

    try {
      await allowBtn.click({ force: true });
    } catch (err) {
      console.log(
        'Cookie button click failed:',
        err.message
      );
    }

    await page.waitForTimeout(300);
  }
}

async function hoverPricePanel(page, pricePanel) {
  await dismissCookieBanner(page);

  await pricePanel
    .scrollIntoViewIfNeeded()
    .catch(() => {});

  const box = await pricePanel
    .boundingBox()
    .catch(() => null);

  if (!box) {
    throw new Error(
      'Price panel has no bounding box'
    );
  }

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

async function clickPriceButton(
  page,
  pricePanel,
  checkBtn
) {
  await hoverPricePanel(page, pricePanel);

  const visible = await checkBtn
    .isVisible()
    .catch(() => false);

  if (!visible) {
    throw new Error(
      'Check-price button is not visible'
    );
  }

  for (let i = 0; i < 20; i++) {
    await dismissCookieBanner(page);

    if (
      await checkBtn
        .isEnabled()
        .catch(() => false)
    ) {
      await checkBtn.click({ force: true });
      return true;
    }

    await hoverPricePanel(
      page,
      pricePanel
    ).catch(() => {});

    await page.waitForTimeout(300);
  }

  throw new Error(
    'Check-price button never became enabled'
  );
}

async function getPanelState(page, pricePanel) {
  const panelText = await pricePanel
    .innerText()
    .catch(() => '');

  // Remove zero-width characters used by the store
  // in the visible current price.
  const cleanText = panelText
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  console.log(
    'CLEAN PANEL:',
    cleanText.slice(0, 500)
  );

  const lines = cleanText
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean);

  /*
   * Look for the visible current price.
   *
   * Ignore:
   * - member price
   * - saving text
   * - delivery text
   * - obvious old/struck-through price
   *
   * The visible current price in this store is normally
   * represented as text in the panel, sometimes split
   * by zero-width characters.
   */
  for (const line of lines) {
    if (
      /₹\s*[\d,]+(?:\.\d{1,2})?/.test(line) &&
      !/member price/i.test(line) &&
      !/saving/i.test(line) &&
      !/usually/i.test(line) &&
      !/delivered/i.test(line)
    ) {
      const price = parsePrice(line);

      if (price !== null) {
        return {
          type: 'success',
          price,
          panelText
        };
      }
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

  if (
    /loading current price|retrying/i.test(
      panelText
    )
  ) {
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
  const deadline =
    Date.now() + ATTEMPT_WAIT_MS;

  let lastText = '';

  while (Date.now() < deadline) {
    await dismissCookieBanner(page);

    const state = await getPanelState(
      page,
      pricePanel
    );

    lastText = state.panelText || '';

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

    await page.waitForTimeout(POLL_MS);
  }

  return {
    type: 'timeout',
    panelText: lastText
  };
}

async function clickRetry(page, pricePanel) {
  await dismissCookieBanner(page);

  await hoverPricePanel(
    page,
    pricePanel
  ).catch(() => {});

  const retryBtn = page.getByRole(
    'button',
    {
      name: /retry|check again/i
    }
  );

  const visible = await retryBtn
    .isVisible()
    .catch(() => false);

  if (!visible) {
    return false;
  }

  const enabled = await retryBtn
    .isEnabled()
    .catch(() => false);

  if (!enabled) {
    return false;
  }

  await retryBtn.click({
    force: true
  });

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

async function scrapeProduct(
  itemId,
  optionLabel,
  { headed = false } = {}
) {
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

  const networkLog = [];
  const MAX_NETWORK_LOG = 150;

  page.on('request', request => {
    try {
      networkLog.push({
        type: 'request',
        method: request.method(),
        resourceType:
          request.resourceType(),
        url: request.url(),
        atMs: Date.now()
      });

      if (
        networkLog.length >
        MAX_NETWORK_LOG
      ) {
        networkLog.shift();
      }
    } catch {}
  });

  page.on('response', async response => {
    try {
      const request =
        response.request();

      let bodySnippet = '';

      if (
        request.resourceType() ===
          'xhr' ||
        request.resourceType() ===
          'fetch'
      ) {
        try {
          bodySnippet = (
            await response.text()
          ).slice(0, 500);
        } catch {}
      }

      networkLog.push({
        type: 'response',
        method: request.method(),
        resourceType:
          request.resourceType(),
        status: response.status(),
        url: response.url(),
        bodySnippet,
        atMs: Date.now()
      });

      if (
        networkLog.length >
        MAX_NETWORK_LOG
      ) {
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

    const optionButton =
      page.getByRole('button', {
        name: optionLabel,
        exact: true
      });

    await optionButton.click({
      force: true
    });

    await dismissCookieBanner(page);

    await page.waitForTimeout(500);

    const pricePanel =
      page.locator('.offer-panel');

    const checkBtn =
      page.getByRole('button', {
        name: /check today.?s price/i
      });

    // First challenge
    await clickPriceButton(
      page,
      pricePanel,
      checkBtn
    );

    while (
      attempts < MAX_RETRIES &&
      Date.now() - startTime <
        MAX_TOTAL_MS
    ) {
      attempts++;

      const state =
        await waitForPrice(
          page,
          pricePanel
        );

      lastPanelText =
        state.panelText || '';

      console.log(
        `Attempt ${attempts}: ${state.type} | ${lastPanelText.slice(
          0,
          180
        )}`
      );

      // SUCCESS
      if (state.type === 'success') {
        price = state.price;

        const soldOut =
          await page
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
      if (
        state.type ===
        'rate_limited'
      ) {
        console.log(
          `429 detected on attempt ${attempts}. Applying backoff.`
        );

        const backoffMs =
          Math.min(
            30000,
            5000 *
              Math.pow(
                2,
                Math.min(
                  attempts - 1,
                  3
                )
              )
          );

        await page.waitForTimeout(
          backoffMs
        );
      }

      // CHALLENGE FAILURE
      else if (
        state.type ===
        'challenge_failed'
      ) {
        challengeFailures++;

        console.log(
          `Challenge failed (${challengeFailures}).`
        );

        await page.waitForTimeout(
          1000
        );
      }

      // TIMEOUT
      else if (
        state.type === 'timeout'
      ) {
        console.log(
          `Price still loading after ${ATTEMPT_WAIT_MS}ms.`
        );

        await page.waitForTimeout(
          1000
        );
      }

      // Periodically reload after repeated
      // challenge failures.
      if (
        challengeFailures > 0 &&
        challengeFailures %
          RELOAD_AFTER_FAILURES ===
          0
      ) {
        console.log(
          'Reloading page to reset challenge state...'
        );

        await page.reload({
          waitUntil:
            'domcontentloaded',
          timeout: 60000
        });

        await page.waitForTimeout(
          1500
        );

        await dismissCookieBanner(
          page
        );

        await page
          .getByRole('button', {
            name: optionLabel,
            exact: true
          })
          .click({
            force: true
          });

        await dismissCookieBanner(
          page
        );

        await page.waitForTimeout(
          500
        );

        await clickPriceButton(
          page,
          pricePanel,
          checkBtn
        );
      } else {
        // Normal retry.
        const clicked =
          await clickRetry(
            page,
            pricePanel
          );

        if (!clicked) {
          const checkVisible =
            await checkBtn
              .isVisible()
              .catch(
                () => false
              );

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
          Date.now() -
          startTime
        }ms`
      );

      recordFailure({
        itemId,
        optionLabel,
        timestamp:
          new Date().toISOString(),
        attempts,
        panelText:
          lastPanelText,
        networkLog,
        screenshot:
          await captureFailureScreenshot(
            page
          )
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
      timestamp:
        new Date().toISOString(),
      attempts,
      panelText:
        lastPanelText,
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
    timestamp:
      new Date().toISOString()
  };
}

module.exports = {
  scrapeProduct,
  getRecentFailures
};