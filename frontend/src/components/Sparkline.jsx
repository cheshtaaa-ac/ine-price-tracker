export default function Sparkline({ points }) {
  const values = points.filter((p) => p.price != null).map((p) => p.price);
  if (values.length < 2) {
    return <p className="empty-state">Not enough successful scrapes yet to chart a trend.</p>;
  }

  const width = 100;
  const height = 100;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const successful = points.filter((p) => p.price != null);
  const coords = successful.map((p, i) => {
    const x = (i / (successful.length - 1)) * width;
    const y = height - ((p.price - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <div className="sparkline-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="90" preserveAspectRatio="none">
        <polyline
          points={coords.join(' ')}
          fill="none"
          stroke="#e8a33d"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
        <span>₹{min.toLocaleString('en-IN')}</span>
        <span>₹{max.toLocaleString('en-IN')}</span>
      </div>
    </div>
  );
}
