# INE Product Price Tracker

A full-stack product price tracker built for the INE Software Engineer Intern assignment.

The application allows users to search for products from INE's hosted mock store, select a specific product option, track it, scrape its current price and stock on a fixed schedule, and view the resulting history.

## Features

* Search products by partial or full name
* Select a specific product option
* Track products for scheduled scraping
* Scrape current price and stock using Playwright
* Retry slow or failed price loads
* Record every scrape attempt and its outcome
* View price and stock history over time
* View a per-product scrape log
* Export complete scrape history as CSV
* Run scheduled scraping through an external cron service

## Tech Stack

### Frontend

* React.js
* Vite
* Deployed on Vercel

### Backend

* Node.js
* Express
* Playwright
* Deployed on Render

### Database

* Supabase (PostgreSQL)

### Scheduling

* cron-job.org

## Scraping

The mock store deliberately makes price retrieval unreliable. The price and stock information is gated behind browser-based interaction, so Playwright is used to interact with the page.

The scraper handles conditions including:

* Slow price loading
* Timeouts
* Temporary challenge failures
* Rate-limit responses
* Changes in page state

The scraper can make up to **12 attempts** for a product scrape. Each actual attempt is recorded separately in the scrape log.

For example, if the first two attempts do not retrieve the price and the third succeeds:

```text
Attempt 1 → retried
Attempt 2 → retried
Attempt 3 → success
```

If all allowed attempts fail, the final attempt is recorded as:

```text
Attempt 12 → failed
```

Price and stock are only stored after the price has been successfully retrieved. Failed attempts are retained in the history with empty price and stock values.

## Scrape History and Logging

Each scrape attempt is stored with:

* Store product ID
* Product name
* Selected option
* Timestamp in ISO 8601 UTC format
* Price
* Stock
* Outcome
* Attempt number

Possible outcomes are:

* `success` — the current price and stock were retrieved
* `retried` — the attempt did not retrieve the price and another attempt followed
* `failed` — the final allowed attempt did not retrieve the price

The dashboard displays these individual attempts in the per-product scrape log.

## CSV Export

The dashboard provides an Export button that downloads the scrape history as a CSV file.

Each row represents one scrape attempt and contains:

```text
store_product_id
product_name
option
timestamp
price
stock
outcome
attempts
```

Failed attempts are included with price and stock left empty.

## Scheduled Scraping

The backend exposes a `/scrape-all` endpoint.

An external cron service triggers this endpoint **every 2 hours** because the backend is hosted on a free-tier service that may sleep when inactive.

The endpoint returns `202 Accepted` immediately and continues the scraping process in the background. Tracked products are processed sequentially and their results are written to Supabase.

## API Endpoints

Main backend endpoints include:

```text
GET  /health
GET  /products
POST /products
POST /scrape/:productId
POST /scrape-all
GET  /products/:productId/history
GET  /export
```

## Environment Variables

### Backend

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
PORT
```

### Frontend

```text
VITE_API_BASE_URL
```

The frontend API URL should point to the deployed Render backend.

## Local Setup

Clone the repository:

```bash
git clone https://github.com/cheshtaaa-ac/ine-price-tracker.git
cd ine-price-tracker
```

### Backend

```bash
cd backend
npm install
npm start
```

### Frontend

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

## Live Application

Frontend:

https://ine-price-tracker-taupe.vercel.app/

Backend:

https://ine-price-tracker-1-5ld7.onrender.com

## Repository

https://github.com/cheshtaaa-ac/ine-price-tracker

## Scheduled Scrape Frequency

Scheduled scraping is configured through cron-job.org to trigger the backend every **2 hours**.

The live dashboard contains tracked products and their corresponding price history and scrape logs.

## Design and Reliability

The scraper uses Playwright because the price-check flow requires browser interaction with the mock store.

The scraper uses retries and explicit failure handling so that temporary failures do not silently terminate the scrape. It also avoids storing incomplete or guessed price and stock values.

Further implementation details, trade-offs, testing observations, and development changes are documented in `DESIGN_NOTE.md`.
