const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message = isJson ? body.error || JSON.stringify(body) : body;
    throw new Error(message || `Request failed (${res.status})`);
  }
  return body;
}

export const api = {
  health: () => request('/health'),
  listProducts: () => request('/products'),
  addProduct: (payload) =>
    request('/products', { method: 'POST', body: JSON.stringify(payload) }),
  scrapeOne: (productId) => request(`/scrape/${productId}`, { method: 'POST' }),
  scrapeAll: () => request('/scrape-all', { method: 'POST' }),
  history: (productId) => request(`/products/${productId}/history`),
  exportUrl: () => `${BASE_URL}/export`,
};
