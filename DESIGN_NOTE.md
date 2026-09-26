# Design Note

## Why Playwright, not lightweight HTTP fetching

The store loads its product listing and basic product data through a JSON API, so a
lightweight fetch would work for that part. But the actual price and stock are gated
behind a client-side "challenge" that only runs in a real browser: it requires hovering
over the offer panel to enable a "check today's price" button, then polling while the
page resolves the challenge, which fails intentionally on a chunk of attempts. None of
that state exists in the raw HTML or the JSON responses, so a headless browser
(Playwright) was the only reliable way to get a real price, not a workaround chosen for
convenience.

## Making the scraper reliable

- **Cookie banner**: re-checked and dismissed before every meaningful action, not just
  once on page load, because it can reappear mid-flow.
- **Hover, not click**: the offer panel only reveals the price-check button on hover;
  clicking directly missed it.
- **Retry loop**: up to 12 attempts over a 2-minute window, waiting 4 seconds between
  checks, distinguishing three outcomes: `success` (worked first try), `retried` (worked
  after N attempts), `failed` (gave up within the time budget). All three are written to
  `scrape_log` — a failed attempt is still a real, honest data point, not something to
  hide or silently drop.
- **Never store partial/wrong data**: price and stock are only written when both are
  confidently parsed; a failed attempt leaves them empty rather than guessing.
- **Render free-tier memory**: Chromium's default flags overran the free-tier RAM limit
  and crashed the container under load, so it launches with `--single-process`,
  `--no-zygote`, and `--disable-dev-shm-usage` to fit inside it.

## Trade-offs

- Playwright is heavier and slower than an HTTP client, but the site's challenge genuinely
  requires a real browser — there was no lightweight path that could see the actual price.
- Retries add latency per scrape (worst case ~2 minutes), which is fine given the 2-hour
  schedule but wouldn't scale to a much tighter interval without running scrapes in
  parallel.

## What the AI got wrong on the first attempt, and how it was fixed

I used [Claude / name your tool] to help write the scraper and backend. It didn't work
correctly out of the box — three specific mistakes, each found by actually running it
against the live store and reading what failed:

1. **Assumed click-to-reveal instead of hover.** The first version clicked the offer
   panel to reveal the price-check button; it never appeared. Watching a headed run
   showed the button only activates on hover, not click — fixed by switching to
   `.hover()` before checking the button's disabled state.
2. **Underestimated retry counts.** The challenge failed far more often, and took longer
   to resolve, than the first version assumed — a handful of retries wasn't enough and
   attempts were being marked `failed` when a real price would have appeared with more
   patience. Increased retries and total time budget after observing actual failure
   rates over several runs.
3. **Missed the Render memory constraint.** The container was crashing silently in
   production even though it ran fine locally. Render logs showed it was getting OOM-killed
   — Chromium's default multi-process model needs more RAM than the free tier gives it.
   Fixed by launching with reduced-memory flags (`--single-process`, `--no-zygote`,
   `--disable-dev-shm-usage`).

All three were caught by actually deploying and watching real runs fail, not by
inspection alone — which is also why the scrape log intentionally keeps every failed
attempt visible rather than only showing successes.
