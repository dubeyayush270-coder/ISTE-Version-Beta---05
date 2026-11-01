import { useState } from 'react';
import { ArrowDownUp, ExternalLink, Search } from 'lucide-react';
import './PriceComparison.css';

// Official online storefront handoff only. No unverified live prices.
const STORES = [
  { name: 'Blinkit', url: (term) => `https://blinkit.com/s/?q=${encodeURIComponent(term)}` },
  { name: 'Zepto', url: (term) => `https://www.zepto.com/search?query=${encodeURIComponent(term)}` },
  { name: 'Swiggy Instamart', url: () => 'https://www.swiggy.com/instamart' },
];

export default function PriceComparison({ rows = [] }) {
  const [selectedKey, setSelectedKey] = useState('');
  const [searchText, setSearchText] = useState(null);
  const item = rows.find((row) => row.key === selectedKey) || rows[0] || null;
  const query = (searchText ?? item?.name ?? '').trim();
  const isListItem = item && query.toLowerCase() === String(item.name).trim().toLowerCase();

  return (
    <section className="ks-price" aria-label="Compare online grocery prices">
      <div className="ks-price-heading">
        <span className="ks-price-heading-icon"><ArrowDownUp size={20} /></span>
        <div>
          <span className="ks-price-eyebrow">ONLINE ONLY</span>
          <h2>Compare Online</h2>
          <p>Search groceries across online stores.</p>
        </div>
      </div>

      <label className="ks-price-picker">
        <span>Search ingredient</span>
        <span style={{ position: 'relative', display: 'block' }}>
          <Search size={17} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.65 }} />
          <input
            type="search"
            aria-label="Search ingredient"
            placeholder="e.g. Paneer, Rice, Milk"
            value={searchText ?? item?.name ?? ''}
            onChange={(event) => setSearchText(event.target.value)}
            style={{ width: '100%', paddingLeft: 38, boxSizing: 'border-box' }}
          />
        </span>
      </label>

      {rows.length > 0 && (
        <label className="ks-price-picker">
          <span>From shopping list</span>
          <select
            value={item?.key ?? ''}
            onChange={(event) => {
              setSelectedKey(event.target.value);
              const selected = rows.find((row) => row.key === event.target.value);
              setSearchText(selected?.name ?? '');
            }}
          >
            {rows.map((row) => (
              <option key={row.key} value={row.key}>{row.name} · {row.unit}</option>
            ))}
          </select>
        </label>
      )}

      {isListItem && (
        <p className="ks-price-context"><strong>{item.name}</strong> · Need {item.missing} {item.unit}</p>
      )}

      <div className="ks-price-offers">
        {STORES.map((store) => (
          <article className="ks-price-offer" key={store.name}>
            <div className="ks-price-offer-main">
              <div className="ks-price-offer-store">{store.name}</div>
              {query ? (
                <a
                  className="ks-price-primary"
                  href={store.url(query)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Check ${query} on ${store.name} (opens new tab)`}
                >
                  Check Price <ExternalLink size={15} aria-hidden="true" />
                </a>
              ) : (
                <span className="ks-price-primary" aria-disabled="true" style={{ opacity: 0.45 }}>Enter item</span>
              )}
            </div>
          </article>
        ))}
      </div>

      <p className="ks-price-disclaimer">
        Check matching pack sizes and delivery fees in each store. Instamart opens its home page for manual search. KitchenSync does not fetch live prices.
      </p>
    </section>
  );
}
