import { useState } from "react";
import { ExternalLink, ShoppingCart } from "lucide-react";

const PROVIDERS = [
  { name: "Blinkit", url: "https://blinkit.com/" },
  { name: "Zepto", url: "https://www.zepto.com/" },
  { name: "Swiggy Instamart", url: "https://www.swiggy.com/instamart/" },
];

export default function QuickCommerceHandoff({ items = [] }) {
  const [message, setMessage] = useState("");
  const products = items.filter(item =>
    typeof item.name === "string" && item.name.trim() &&
    Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0
  );

  function openProvider(provider) {
    window.open(provider.url, "_blank", "noopener,noreferrer");
    setMessage(`If ${provider.name} opened, search for your groceries there. KitchenSync does not fill carts automatically.`);
  }

  return (
    <section className="k-card p-4 md:p-6 mt-4" aria-label="Quick-commerce store links">
      <div className="flex items-center gap-3 mb-3">
        <ShoppingCart size={23} className="text-[#21835b]" />
        <div>
          <h2 className="text-lg font-bold text-[#244d35]">Shop with an external store</h2>
          <p className="text-sm text-[#5f7d69]">{products.length} items remain unchecked on your KitchenSync list.</p>
        </div>
      </div>
      <p className="text-sm text-[#607c69] leading-relaxed">
        Use the single <strong>Copy list</strong> action above, then choose a retailer.
        The shop opens separately; products are not placed in a cart automatically.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        {PROVIDERS.map(provider => (
          <button key={provider.name} type="button" onClick={() => openProvider(provider)}
            className="flex items-center justify-center gap-2 min-h-12 rounded-xl border border-[#bfd8c7] bg-[#edf6ef] px-4 py-3 text-sm font-bold text-[#276b48] hover:bg-[#dff0e4]">
            {provider.name} <ExternalLink size={16} />
          </button>
        ))}
      </div>
      {message && <p role="status" className="text-sm text-[#367b51] mt-4">{message}</p>}
      <p className="text-xs text-[#738878] leading-relaxed mt-4">
        Verify delivery location, pack sizes, prices, and availability in the store.
        Record actual purchases in Pantry after buying.
      </p>
    </section>
  );
}
