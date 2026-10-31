
import { useState } from "react";
import { Copy, ExternalLink, ShoppingCart } from "lucide-react";

const PROVIDERS = [
  { name: "Blinkit", url: "https://blinkit.com/" },
  { name: "Zepto", url: "https://www.zepto.com/" },
  {
    name: "Swiggy Instamart",
    url: "https://www.swiggy.com/instamart/"
  }
];

function formatQuantity(quantity) {
  const number = Number(quantity);
  if (!Number.isFinite(number)) return "0";
  return Number(number.toFixed(2)).toString();
}

export default function QuickCommerceHandoff({ items = [] }) {
  const [excluded, setExcluded] = useState({});
  const [message, setMessage] = useState("");

  // Expected input:
  // [{ name: "Tomato", quantity: 300, unit: "g" }]
  //
  // Pass SHORTAGES here, not the full pantry inventory.
  const products = items.filter(item => {
    return (
      typeof item.name === "string" &&
      item.name.trim() &&
      Number.isFinite(Number(item.quantity)) &&
      Number(item.quantity) > 0
    );
  });

  function itemKey(item) {
    return `${item.name.toLowerCase()}|${item.unit || "pcs"}`;
  }

  const selected = products.filter(
    item => !excluded[itemKey(item)]
  );

  function toggleItem(item) {
    const key = itemKey(item);

    setExcluded(previous => ({
      ...previous,
      [key]: !previous[key]
    }));

    setMessage("");
  }

  const shoppingText = [
    "KitchenSync Shopping List",
    "",
    ...selected.map(
      item =>
        `- ${item.name}: ${formatQuantity(item.quantity)} ${item.unit || "pcs"}`
    ),
    "",
    "Please verify pack sizes, availability and prices."
  ].join("\n");

  async function copyList() {
    if (!selected.length) return;

    try {
      await navigator.clipboard.writeText(shoppingText);
      setMessage("Shopping list copied to clipboard.");
    } catch {
      setMessage(
        "Could not copy automatically. Check browser clipboard permissions."
      );
    }
  }

  function openProvider(provider) {
    // Open immediately from the button click, to reduce
    // the chance of the browser blocking the new tab.
    window.open(
      provider.url,
      "_blank",
      "noopener,noreferrer"
    );

    setMessage(
      `Opened ${provider.name}. Use your selected list to search for products and complete the order there.`
    );
  }

  return (
    <section className="k-card p-5 md:p-7 mt-5">
      <div className="flex items-center gap-3 mb-3">
        <ShoppingCart
          size={24}
          className="text-[#21835b]"
        />

        <div>
          <h2 className="text-lg font-bold text-[#244d35]">
            Shopping List & Quick-Commerce
          </h2>

          <p className="text-sm text-[#738878]">
            Select what you need and hand off your list.
          </p>
        </div>
      </div>

      {products.length === 0 ? (
        <p className="text-sm text-[#738878] mt-4">
          No shopping shortages found for this selection.
        </p>
      ) : (
        <>
          <div className="space-y-2 mt-5">
            {products.map((item, index) => (
              <label
                key={`${itemKey(item)}-${index}`}
                className="flex items-center gap-3 rounded-xl border border-[#e2ece3] p-3 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={!excluded[itemKey(item)]}
                  onChange={() => toggleItem(item)}
                  className="accent-[#21835b]"
                />

                <span className="flex-1 text-sm font-semibold text-[#244d35]">
                  {item.name}
                </span>

                <span className="text-sm text-[#738878]">
                  {formatQuantity(item.quantity)}{" "}
                  {item.unit || "pcs"}
                </span>
              </label>
            ))}
          </div>

          <p className="text-xs text-[#738878] mt-3">
            {selected.length} of {products.length} items selected
          </p>

          <button
            type="button"
            disabled={selected.length === 0}
            onClick={copyList}
            className="k-button k-primary w-full mt-4"
          >
            <Copy size={16} />
            Copy Selected Shopping List
          </button>

          <h3 className="font-bold mt-6 mb-3 text-[#244d35]">
            Continue on a quick-commerce app
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PROVIDERS.map(provider => (
              <button
                key={provider.name}
                type="button"
                onClick={() => openProvider(provider)}
                className="flex items-center justify-center gap-2 rounded-xl border border-[#bfd8c7] bg-[#edf6ef] px-4 py-3 text-sm font-bold text-[#276b48] hover:bg-[#dff0e4]"
              >
                {provider.name}
                <ExternalLink size={15} />
              </button>
            ))}
          </div>

          {message && (
            <p
              role="status"
              className="text-sm text-[#367b51] mt-4"
            >
              {message}
            </p>
          )}

          <p className="text-xs text-[#8a968a] mt-4">
            Select Copy Selected Shopping List, then open
            your preferred store. Products are not added
            automatically to its cart. Confirm the delivery
            location, product sizes, prices and availability
            before checkout. Record actual purchases in
            KitchenSync Pantry after delivery.
          </p>
        </>
      )}
    </section>
  );
}
