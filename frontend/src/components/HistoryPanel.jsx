import { useEffect, useState } from 'react';
import { api } from '../api';
import Sparkline from './Sparkline';

function formatTimestamp(ts) {
  return new Date(ts).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryPanel({ productId, refreshKey }) {
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const data = await api.history(productId);

        if (!cancelled) {
          setLog(data);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadHistory();

    const interval = setInterval(loadHistory, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
}, [productId, refreshKey]);

  if (loading) return <p className="empty-state">Loading history…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!log.length) {
    return (
      <p className="empty-state">
        No scrapes recorded yet for this product.
      </p>
    );
  }

  const latest = log[log.length - 1];

  return (
    <div className="detail-grid">
      <div>
        <div style={{ marginBottom: 12 }}>
          <div className="price-label">Latest price</div>
          <div className="price-now">
            {latest.price != null
              ? `₹${latest.price.toLocaleString('en-IN')}`
              : '—'}
          </div>
          <div className="price-label">
            {latest.stock || 'Unknown stock'} · last checked{' '}
            {formatTimestamp(latest.timestamp)}
          </div>
        </div>

        <Sparkline points={log} />
      </div>

      <div>
        <div className="price-label" style={{ marginBottom: 8 }}>
          Scrape log ({log.length} attempts)
        </div>

        <div className="log-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Outcome</th>
              </tr>
            </thead>

            <tbody>
              {[...log].reverse().map((entry) => (
                <tr key={entry.timestamp}>
                  <td>{formatTimestamp(entry.timestamp)}</td>
                  <td>
                    {entry.price != null
                      ? `₹${entry.price.toLocaleString('en-IN')}`
                      : '—'}
                  </td>
                  <td>{entry.stock || '—'}</td>
                  <td>
                    <span
                      className={`status-pill status-${entry.outcome}`}
                    >
                      {entry.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}