# Design Note

## Why Playwright, not lightweight HTTP fetching

The store loads its product listing and basic product data through a JSON API, so a lightweight HTTP request would work for that part. However, the actual price and stock are gated behind a client-side challenge that runs in a real browser. It requires hovering over the offer panel to enable the price-check button and then waiting while the page resolves the challenge.

Because this state is not available directly in the raw HTML or JSON responses, Playwright is used to interact with the browser page and obtain the current price and stock.

## Making the scraper reliable

- **Cookie banner:** Re-checked and dismissed before meaningful actions, rather than only once on page load, because it can reappear during the flow.

- **Hover before price check:** The offer panel reveals the price-check button on hover. The scraper uses `.hover()` before checking and interacting with the button.

- **Retry and failure handling:** The scraper retries slow or failed price loads instead of immediately treating them as permanent failures. It handles conditions such as timeouts, upstream `429` rate limits, `503` responses, and challenge failures. The final scrape result is recorded as `success`, `retried`, or `failed`.

- **Extended retry window:** The scraper allows up to 20 attempts with a 4-second delay between attempts and a maximum overall time budget of approximately 3 minutes. This gives the store enough time to recover from temporary failures while keeping the scheduled job bounded.

- **Never store partial or guessed data:** Price and stock are only stored after the required information has been successfully obtained and parsed. If the price challenge cannot be resolved, the scraper does not guess a value.

- **Price parsing:** The scraper reads the visible price panel text and ignores known non-current-price lines such as member pricing, savings, delivery information, and similar text. This avoids selecting hidden or unrelated price values from the page.

- **Failure visibility:** Scrape results are written to the scrape log so that successful, retried, and failed outcomes remain visible instead of being silently discarded.

- **Render memory constraints:** Chromium is launched with memory-saving flags such as `--single-process`, `--no-zygote`, and `--disable-dev-shm-usage` to reduce browser overhead on the Render free tier.

## Scheduled scraping

The `/scrape-all` endpoint is triggered externally by cron-job.org every 2 hours. The endpoint returns `202 Accepted` immediately and continues processing the tracked products in the background.

This prevents the external scheduler from waiting for the complete Playwright scraping process and timing out when the store is slow. Each tracked product is still scraped sequentially and its result is written to Supabase.

## Trade-offs

- Playwright is heavier and slower than an HTTP client, but browser interaction is required to access the price challenge.

- Retries increase the time taken by an individual scrape. This is acceptable for a 2-hour scraping interval, but would need reconsideration for a much more frequent schedule.

- The `/scrape-all` endpoint returns before all products finish so that the external scheduler does not time out. The actual scraping work continues in the backend and is logged when each product completes.

## What changed during development

The scraper was developed iteratively by testing it against the live mock store and adjusting the implementation based on observed behaviour.

Three important issues were identified:

1. **Click vs. hover:** The initial implementation tried clicking the offer panel, but the price-check button only became available after hovering. This was corrected using `.hover()`.

2. **Retry duration and transient failures:** Initial retry settings were too short for the store's behaviour. Testing showed slow loads and temporary `429`/`503` responses, so the retry count and time budget were increased and explicit handling for these conditions was added.

3. **Price selection:** An early implementation could encounter multiple price-like values in the DOM, including hidden or secondary prices. Testing exposed cases where selecting a price without considering its visibility and surrounding panel text could produce the wrong value. The parser was changed to use the visible price panel text and ignore known secondary-price lines.

These issues were identified through actual testing and deployment rather than assuming that the first implementation would work correctly.

## AI Tool Use

AI tools were used occasionally for debugging, understanding errors, and discussing implementation approaches. The suggestions were checked against the mock store during development.