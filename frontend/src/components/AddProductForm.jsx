import { useState } from 'react';

export default function AddProductForm({ onAdd }) {
  const [form, setForm] = useState({ store_product_id: '', product_name: '', option_name: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.store_product_id || !form.product_name || !form.option_name) {
      setError('All three fields are required.');
      return;
    }
    setSaving(true);
    try {
      await onAdd(form);
      setForm({ store_product_id: '', product_name: '', option_name: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="store_product_id">Store product ID</label>
        <input
          id="store_product_id"
          value={form.store_product_id}
          onChange={(e) => update('store_product_id', e.target.value)}
          placeholder="e.g. 2907"
        />
      </div>
      <div className="field">
        <label htmlFor="product_name">Product name</label>
        <input
          id="product_name"
          value={form.product_name}
          onChange={(e) => update('product_name', e.target.value)}
          placeholder="As shown on the store"
        />
      </div>
      <div className="field">
        <label htmlFor="option_name">Option</label>
        <input
          id="option_name"
          value={form.option_name}
          onChange={(e) => update('option_name', e.target.value)}
          placeholder="e.g. Starter"
        />
      </div>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={saving} style={{ width: '100%' }}>
        {saving ? 'Adding…' : 'Track product'}
      </button>
    </form>
  );
}
