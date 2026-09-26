import { useState } from 'react';
import HistoryPanel from './HistoryPanel';

export default function ProductCard({ product, onScrapeOne }) {
  const [open, setOpen] = useState(false);
  const [scraping, setScraping] = useState(false);

  async function handleScrape(e) {
    e.stopPropagation();
    setScraping(true);
    try {
      await onScrapeOne(product.id);
    } finally {
      setScraping(false);
    }
  }

  return (
    <div className={`product-card ${open ? 'is-open' : ''}`}>
      <div className="product-head" onClick={() => setOpen((v) => !v)}>
        <div>
          <div className="product-name">{product.product_name}</div>
          <div className="product-meta">
            id {product.store_product_id} · option {product.option_name}
          </div>
        </div>
        <div className="product-actions">
          <button className="btn" onClick={handleScrape} disabled={scraping}>
            {scraping ? 'Scraping…' : 'Scrape now'}
          </button>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <div className="product-detail">
          <HistoryPanel productId={product.id} />
        </div>
      )}
    </div>
  );
}
