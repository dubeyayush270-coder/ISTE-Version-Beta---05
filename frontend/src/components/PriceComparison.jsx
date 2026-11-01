import { useState } from 'react';
import { ArrowDownUp, ExternalLink } from 'lucide-react';
import './PriceComparison.css';

// Only open official online storefronts. KitchenSync cannot currently
// fetch or compare verified live prices from these services.
const STORES = [
  {
    name: 'Blinkit',
    url: (name) => `https://blinkit.com/s/?q=${encodeURIComponent(name)}`,
  },
  {
    name: 'Zepto',
    url: (name) => `https://www.zepto.com/search?query=${encodeURIComponent(name)}`,
  },
  {
    name: 'Swiggy Instamart',
    url: () => 'https://www.swiggy.com/instamart',
  },
];

export default function PriceComparison({ rows = [] }) {
  const [selectedKey, setSelectedKey] = useState('');
  const item = rows.find((row) => row.key === selectedKey) || rows[0] || null;

  return (
    <section className="ks-price" aria-label="Compare online grocery prices">
      <div className="ks-price-heading">
        <span className="ks-price-heading-icon"><ArrowDownUp size={20} /></span>
        <div>
          <span className="ks-price-eyebrow">ONLINE ONLY</span>
          <h2>Compare Online</h2>
          <p>Check current prices in each store.</p>
        </div>
      </div>

      {!item ? (
        <div className="ks-price-empty">No items to compare.</div>
      ) : (
        <>
          <label className="ks-price-picker">
            Ingredient
            <select value={item.key} onChange={(event) => setSelectedKey(event.target.value)}>
              {rows.map((row) => (
                <option key={row.key} value={row.key}>{row.name} · {row.unit}</option>
              ))}
            </select>
          </label>

          <p className="ks-price-context">
            <strong>{item.name}</strong> · Need {item.missing} {item.unit}
          </p>

          <div className="ks-price-offers">
            {STORES.map((store) => (
              <article className="ks-price-offer" key={store.name}>
                <div className="ks-price-offer-main">
                  <div className="ks-price-offer-store">{store.name}</div>
                  <a
                    className="ks-price-primary"
                    href={store.url(item.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Check ${item.name} on ${store.name} (opens new tab)`}
                  >
                    Check Price <ExternalLink size={15} aria-hidden="true" />
                  </a>
                </div>
              </article>
            ))}
          </div>

          <p className="ks-price-disclaimer">
            Prices are shown by each store after you set your delivery location.
            Compare the same pack size and delivery fees. No live prices are fetched by KitchenSync.
          </p>
        </>
      )}
    </section>
  );
}
