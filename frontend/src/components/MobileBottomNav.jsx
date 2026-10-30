

import React from "react";
import {
  House,
  CalendarDays,
  BookOpen,
  Package,
  ShoppingBasket
} from "lucide-react";

const tabs = [
  {
    label: "Home",
    id: "dashboard",
    icon: House
  },
  {
    label: "Planner",
    id: "planner",
    icon: CalendarDays
  },
  {
    label: "Recipes",
    id: "recipes",
    icon: BookOpen
  },
  {
    label: "Pantry",
    id: "inventory",
    icon: Package
  },
  {
    label: "Shopping",
    id: "shopping",
    icon: ShoppingBasket
  }
];

export default function MobileBottomNav({
  section,
  onNavigate
}) {
  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="Mobile navigation"
    >
      {tabs.map(({ label, id, icon: Icon }) => {
        const active = section === id;

        return (
          <button
            key={id}
            type="button"
            className={`mobile-nav-item ${
              active ? "selected" : ""
            }`}
            onClick={() => onNavigate(id)}
            aria-current={active ? "page" : undefined}
          >
            <Icon
              size={22}
              strokeWidth={active ? 2.5 : 2}
            />

            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
