global.WebSocket = require('ws');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { scrapeProduct } = require('./scraper');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get('/health', (req, res) => res.json({ ok: true }));

// Add a product to track
app.post('/products', async (req, res) => {
  const { store_product_id, product_name, option_name } = req.body;
  if (!store_product_id || !product_name || !option_name) {
    return res.status(400).json({ error: 'store_product_id, product_name, option_name required' });
  }

  const { data, error } = await supabase
    .from('tracked_products')
    .insert([{ store_product_id, product_name, option_name }])
    .select();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This product and option is already being tracked.' });
    }
    return res.status(500).json({ error: error.message });
  }

  res.json(data[0]);
});

// List tracked products
app.get('/products', async (req, res) => {
  const { data, error } = await supabase.from('tracked_products').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Scrape one tracked product now, save result to scrape_log
app.post('/scrape/:productId', async (req, res) => {
  const { productId } = req.params;

  const { data: product, error: findErr } = await supabase
    .from('tracked_products')
    .select('*')
    .eq('id', productId)
    .single();
  if (findErr || !product) return res.status(404).json({ error: 'Product not found' });

  const result = await scrapeProduct(product.store_product_id, product.option_name);

  const { error: insertErr } = await supabase.from('scrape_log').insert([{
    product_id: product.id,
    timestamp: result.timestamp,
    price: result.price,
    stock: result.stock,
    outcome: result.outcome
  }]);
  if (insertErr) return res.status(500).json({ error: insertErr.message });

  res.json(result);
});

// Scrape ALL tracked products (this is what cron-job.org will hit every 2 hours)
app.post('/scrape-all', async (req, res) => {
  const { data: products, error } = await supabase.from('tracked_products').select('*');
  if (error) return res.status(500).json({ error: error.message });

  const results = [];
  for (const product of products) {
    const result = await scrapeProduct(product.store_product_id, product.option_name);
    await supabase.from('scrape_log').insert([{
      product_id: product.id,
      timestamp: result.timestamp,
      price: result.price,
      stock: result.stock,
      outcome: result.outcome
    }]);
    results.push({ product: product.product_name, ...result });
  }
  res.json({ scraped: results.length, results });
});

// Price/stock history + scrape log for one product
app.get('/products/:productId/history', async (req, res) => {
  const { productId } = req.params;
  const { data, error } = await supabase
    .from('scrape_log')
    .select('*')
    .eq('product_id', productId)
    .order('timestamp', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// CSV export of full scrape history across all products
app.get('/export', async (req, res) => {
  const { data: logs, error } = await supabase
    .from('scrape_log')
    .select('*, tracked_products(store_product_id, product_name, option_name)')
    .order('timestamp', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const header = 'store_product_id,product_name,option,timestamp,price,stock,outcome\n';
  const rows = logs.map(log => {
    const p = log.tracked_products || {};
    const price = log.price ?? '';
    const stock = log.stock ?? '';
    return `${p.store_product_id || ''},"${p.product_name || ''}","${p.option_name || ''}",${log.timestamp},${price},${stock},${log.outcome}`;
  }).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=scrape_history.csv');
  res.send(header + rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));