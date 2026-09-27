import { useEffect, useState } from 'react';
import { api } from './api';
import AddProductForm from './components/AddProductForm';
import ProductCard from './components/ProductCard';

export default function App() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [scrapingAll, setScrapingAll] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  function loadProducts() {
    api
      .listProducts()
      .then(setProducts)
      .catch((err) => setListError(err.message))
      .finally(() => setLoading(false));
  }

  // Initial load + automatic refresh every 15 seconds
  useEffect(() => {
    loadProducts();

    const interval = setInterval(() => {
      loadProducts();
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  async function handleAdd(payload) {
    await api.addProduct(payload);
    loadProducts();
  }

  async function handleScrapeOne(productId) {
    await api.scrapeOne(productId);
    loadProducts();
    setHistoryRefreshKey((v) => v + 1);
  }

  async function handleScrapeAll() {
    setScrapingAll(true);
    try {
      await api.scrapeAll();
      loadProducts();
      setHistoryRefreshKey((v) => v + 1);
    } finally {
      setScrapingAll(false);
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <h1>Price Watch</h1>
          <p>
            Tracking product price and stock on the INE mock store, every 2
            hours.
          </p>
        </div>

        <div className="topbar-actions">
          <button
            className="btn"
            onClick={handleScrapeAll}
            disabled={scrapingAll}
          >
            {scrapingAll ? 'Scraping all…' : 'Scrape all now'}
          </button>

          <a className="btn" href={api.exportUrl()}>
            Export CSV
          </a>
        </div>
      </div>

      <div className="layout">
        <div className="panel">
          <h2>Track a product</h2>
          <AddProductForm onAdd={handleAdd} />
        </div>

        <div>
          {loading && (
            <p className="empty-state">Loading tracked products…</p>
          )}

          {listError && <p className="form-error">{listError}</p>}

          {!loading && !products.length && (
            <p className="empty-state">
              No products tracked yet. Add one on the left.
            </p>
          )}

          <div className="product-list">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onScrapeOne={handleScrapeOne}
                refreshKey={historyRefreshKey}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}