global.WebSocket = require('ws');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { scrapeProduct } = require('./scraper');

const app = express();

app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.get('/health', (req, res) =>
  res.json({ ok: true })
);

// Add a product to track
app.post('/products', async (req, res) => {
  const {
    store_product_id,
    product_name,
    option_name
  } = req.body;

  if (
    !store_product_id ||
    !product_name ||
    !option_name
  ) {
    return res.status(400).json({
      error:
        'store_product_id, product_name, option_name required'
    });
  }

  const { data, error } = await supabase
    .from('tracked_products')
    .insert([
      {
        store_product_id,
        product_name,
        option_name
      }
    ])
    .select();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error:
          'This product and option is already being tracked.'
      });
    }

    return res.status(500).json({
      error: error.message
    });
  }

  res.json(data[0]);
});

// List tracked products
app.get('/products', async (req, res) => {
  const { data, error } = await supabase
    .from('tracked_products')
    .select('*');

  if (error) {
    return res.status(500).json({
      error: error.message
    });
  }

  res.json(data);
});

// Scrape one tracked product now
app.post('/scrape/:productId', async (req, res) => {
  const { productId } = req.params;

  const {
    data: product,
    error: findErr
  } = await supabase
    .from('tracked_products')
    .select('*')
    .eq('id', productId)
    .single();

  if (findErr || !product) {
    return res.status(404).json({
      error: 'Product not found'
    });
  }

  const result = await scrapeProduct(
    product.store_product_id,
    product.option_name
  );

  // Save every individual scrape attempt.
  const attemptRows = (
    result.attemptLogs || []
  ).map(attempt => ({
    product_id: product.id,
    timestamp: attempt.timestamp,
    price: attempt.price,
    stock: attempt.stock,
    outcome: attempt.outcome,
    attempts: attempt.attempts
  }));

  if (attemptRows.length > 0) {
    const { error: insertErr } =
      await supabase
        .from('scrape_log')
        .insert(attemptRows);

    if (insertErr) {
      return res.status(500).json({
        error: insertErr.message
      });
    }
  }

  res.json(result);
});

// Scheduled scrape for all tracked products
app.post('/scrape-all', async (req, res) => {
  const {
    data: products,
    error
  } = await supabase
    .from('tracked_products')
    .select('*');

  if (error) {
    return res.status(500).json({
      error: error.message
    });
  }

  // Respond immediately so cron-job.org does not wait
  // for all Playwright scrapes to finish.
  res.status(202).json({
    message: 'Scrape started',
    products: products.length
  });

  // Continue scraping in the background.
  (async () => {
    for (const product of products) {
      try {
        const result = await scrapeProduct(
          product.store_product_id,
          product.option_name
        );

        // Save every individual scrape attempt.
        const attemptRows = (
          result.attemptLogs || []
        ).map(attempt => ({
          product_id: product.id,
          timestamp: attempt.timestamp,
          price: attempt.price,
          stock: attempt.stock,
          outcome: attempt.outcome,
          attempts: attempt.attempts
        }));

        if (attemptRows.length > 0) {
          const { error: insertErr } =
            await supabase
              .from('scrape_log')
              .insert(attemptRows);

          if (insertErr) {
            console.error(
              `Failed to save scrape attempts for ${product.product_name}:`,
              insertErr.message
            );
          }
        }

        console.log(
          `Scheduled scrape: ${product.product_name} → ${result.outcome} (${result.attempts} attempts)`
        );
      } catch (err) {
        console.error(
          `Scheduled scrape failed for ${product.product_name}:`,
          err.message
        );
      }
    }

    console.log(
      'Scheduled scrape-all run finished.'
    );
  })();
});

// Price/stock history + scrape log for one product
app.get(
  '/products/:productId/history',
  async (req, res) => {
    const { productId } = req.params;

    const {
      data,
      error
    } = await supabase
      .from('scrape_log')
      .select('*')
      .eq('product_id', productId)
      .order('timestamp', {
        ascending: true
      });

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json(data);
  }
);

// CSV export of full scrape history across all products
app.get('/export', async (req, res) => {
  const {
    data: logs,
    error
  } = await supabase
    .from('scrape_log')
    .select(
      '*, tracked_products(store_product_id, product_name, option_name)'
    )
    .order('timestamp', {
      ascending: true
    });

  if (error) {
    return res.status(500).json({
      error: error.message
    });
  }

  const header =
    'store_product_id,product_name,option,timestamp,price,stock,outcome,attempts\n';

  const rows = logs
    .map(log => {
      const p =
        log.tracked_products || {};

      const price =
        log.price ?? '';

      const stock =
        log.stock ?? '';

      const attempts =
        log.attempts ?? '';

      return `${p.store_product_id || ''},"${p.product_name || ''}","${p.option_name || ''}",${log.timestamp},${price},${stock},${log.outcome},${attempts}`;
    })
    .join('\n');

  res.setHeader(
    'Content-Type',
    'text/csv'
  );

  res.setHeader(
    'Content-Disposition',
    'attachment; filename=scrape_history.csv'
  );

  res.send(header + rows);
});

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () =>
  console.log(
    `Server running on port ${PORT}`
  )
);