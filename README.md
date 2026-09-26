# INE Price Tracker

Tracks price and stock for products on INE's mock store (`demo.inelabteamdev.com`) on a
2-hour schedule, and shows the history and scrape log on a dashboard.

- **Live site:** <!-- Vercel URL here -->
- **Backend:** <!-- Render URL here -->

## Stack

- Backend: Node/Express + Playwright, deployed on Render (Docker)
- Frontend: React (Vite), deployed on Vercel
- Database: Supabase (Postgres) — tables `tracked_products`, `scrape_log`
- Scheduling: cron-job.org sends `POST /scrape-all` every 2 hours

## Repo layout

```
.
├── server.js          # Express API
├── scraper.js          # Playwright scraper
├── scripts/
│   └── headed-test.js  # run locally in headed mode for the demo recording
├── Dockerfile
└── frontend/            # React dashboard (deployed separately on Vercel)
```

## Environment variables

Backend (`.env`, and set the same in Render's dashboard):

| Variable        | Description                          |
|-----------------|---------------------------------------|
| `SUPABASE_URL`  | Supabase project URL                  |
| `SUPABASE_KEY`  | Supabase service/anon key             |
| `PORT`          | Defaults to 3000 locally, 10000 on Render |

Frontend (`frontend/.env`, and set the same in Vercel's dashboard):

| Variable              | Description                          |
|-----------------------|---------------------------------------|
| `VITE_API_BASE_URL`   | Backend's Render URL, no trailing slash |

## Running locally

Backend:

```bash
npm install
cp .env.example .env   # fill in Supabase credentials
node server.js
```

Frontend:

```bash
cd frontend
npm install
cp .env.example .env   # point at http://localhost:3000 for local testing
npm run dev
```

## Scraping schedule

A free cron-job.org job sends `POST https://<render-url>/scrape-all` every 2 hours.
This hits every row in `tracked_products`, scrapes each one with Playwright, and
appends one row to `scrape_log` per attempt — including failed attempts, so the log
stays honest about what actually happened.

## Running the scraper in headed mode

Render has no display, so headed runs are done locally:

```bash
node scripts/headed-test.js 2907 Starter
```

This opens a visible Chromium window and runs the same `scrapeProduct()` function the
backend uses in production.

## API

| Method | Path                        | Purpose                              |
|--------|-----------------------------|----------------------------------------|
| GET    | `/health`                   | Health check                          |
| GET    | `/products`                 | List tracked products                 |
| POST   | `/products`                 | Add a product to track                |
| POST   | `/scrape/:productId`        | Scrape one product now                |
| POST   | `/scrape-all`                | Scrape every tracked product (cron hits this) |
| GET    | `/products/:productId/history` | Full scrape history for one product |
| GET    | `/export`                   | CSV of the full scrape history         |
