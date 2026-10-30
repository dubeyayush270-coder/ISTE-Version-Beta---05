
import { useMemo } from "react";
import {
  CalendarDays,
  ChefHat,
  Check,
  ChevronRight,
  Clock3,
  Flame,
  Package,
  Plus,
  ShoppingBasket,
  Sparkles,
  AlertTriangle
} from "lucide-react";

import "./MobileDashboard.css";

const MEALS = [
  { id: "breakfast", label: "Breakfast", emoji: "🥣" },
  { id: "lunch", label: "Lunch", emoji: "🍛" },
  { id: "dinner", label: "Dinner", emoji: "🍲" }
];

export default function MobileDashboard({
  data,
  onNavigate,
  onPlan
}) {
  const dashboard = data.dashboard;
  const todayMeals = dashboard.today_meals || [];

  const completed = todayMeals.filter(
    meal => Boolean(meal.completed_at)
  ).length;

  const planned = todayMeals.length;
  const progress = (completed / 3) * 100;

  const missing = dashboard.missing_alerts?.length || 0;

  const expiryCount =
    (dashboard.expiring_soon?.length || 0) +
    (dashboard.expired_or_unsafe?.length || 0);

  const calories = useMemo(() => {
    return todayMeals.reduce((total, meal) => {
      const recipe = data.recipes.find(
        item => item.id === meal.recipe_id
      );

      if (!recipe) return total;

      return total +
        recipe.calories_per_serving * meal.eaters;
    }, 0);
  }, [todayMeals, data.recipes]);

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });

  return (
    <div className="ks-mobile-dashboard">
      <div className="ks-mobile-heading">
        <div>
          <p className="ks-subtitle">
            YOUR SMART KITCHEN
          </p>
          <h1>Today <span>🌿</span></h1>
          <p className="ks-date">{today}</p>
        </div>

        <button
          className="ks-calendar-btn"
          onClick={() => onNavigate("planner")}
          aria-label="Open meal planner"
        >
          <CalendarDays size={21} />
        </button>
      </div>

      {/* Meal completion overview */}
      <section className="ks-soft-card ks-overview">
        <div className="ks-card-heading">
          <h2>Daily kitchen overview</h2>
          <span className="ks-status-pill">
            {completed}/3 cooked
          </span>
        </div>

        <div className="ks-progress-layout">
          <div
            className="ks-progress-ring"
            style={{ "--progress": `${progress}%` }}
            role="progressbar"
            aria-valuenow={completed}
            aria-valuemin={0}
            aria-valuemax={3}
            aria-label="Meals cooked today"
          >
            <div className="ks-progress-inner">
              <strong>{completed}/3</strong>
              <span>Meals cooked</span>
            </div>
          </div>

          <div className="ks-progress-info">
            <div className="ks-info-row">
              <span className="ks-info-icon green">
                <Check size={17} />
              </span>
              <div>
                <strong>{planned} planned</strong>
                <small>Today's meals</small>
              </div>
            </div>

            <div className="ks-info-row">
              <span className="ks-info-icon orange">
                <ShoppingBasket size={17} />
              </span>
              <div>
                <strong>{missing} alerts</strong>
                <small>Ingredient shortages</small>
              </div>
            </div>

            <div className="ks-info-row">
              <span className="ks-info-icon amber">
                <Flame size={17} />
              </span>
              <div>
                <strong>~{Math.round(calories)} kcal</strong>
                <small>Planned household total</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Kitchen statistics */}
      <div className="ks-stats-grid">
        <button
          className="ks-soft-card ks-stat-card"
          onClick={() => onNavigate("inventory")}
        >
          <span className="ks-stat-icon">
            <Package size={21} />
          </span>
          <strong>{dashboard.stock_items}</strong>
          <small>Pantry items</small>
        </button>

        <button
          className="ks-soft-card ks-stat-card"
          onClick={() => onNavigate("inventory")}
        >
          <span className="ks-stat-icon warning">
            <Clock3 size={21} />
          </span>
          <strong>{expiryCount}</strong>
          <small>Freshness alerts</small>
        </button>
      </div>

      {/* Today's meals */}
      <section className="ks-meals-section">
        <div className="ks-section-heading">
          <h2>Today's meals</h2>
          <button onClick={() => onNavigate("planner")}>
            View all <ChevronRight size={15} />
          </button>
        </div>

        <div className="ks-meal-list">
          {MEALS.map(slot => {
            const meal = todayMeals.find(
              item => item.meal_type === slot.id
            );

            return (
              <div className="ks-soft-card ks-meal-card" key={slot.id}>
                <span className="ks-meal-emoji">{slot.emoji}</span>

                <div className="ks-meal-details">
                  <small>{slot.label}</small>
                  <strong>
                    {meal?.recipe_name || "Not planned yet"}
                  </strong>
                  <span>
                    {meal
                      ? `${meal.eaters} people · ${meal.minutes} min`
                      : "Choose something delicious"}
                  </span>
                </div>

                {meal ? (
                  <span className={
                    meal.completed_at
                      ? "ks-meal-badge done"
                      : "ks-meal-badge"
                  }>
                    {meal.completed_at ? "Cooked" : "Planned"}
                  </span>
                ) : (
                  <button
                    className="ks-add-meal"
                    aria-label={`Plan ${slot.label}`}
                    onClick={() => onPlan(slot.id)}
                  >
                    <Plus size={20} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick actions */}
      <section className="ks-quick-actions">
        <button
          className="ks-ai-action"
          onClick={() => onNavigate("assistant")}
        >
          <span className="ks-ai-icon">
            <Sparkles size={24} />
          </span>
          <div>
            <strong>Ask KitchenSync AI</strong>
            <small>What should I cook today?</small>
          </div>
          <ChevronRight size={22} />
        </button>

        <button
          className="ks-shopping-action"
          onClick={() => onNavigate("shopping")}
        >
          <ShoppingBasket size={20} />
          <span>View shopping list</span>
          <ChevronRight size={18} />
        </button>
      </section>

      {expiryCount > 0 && (
        <div className="ks-freshness-note">
          <AlertTriangle size={18} />
          <span>
            Some ingredients need a freshness review.
          </span>
        </div>
      )}

      <p className="ks-footer-note">
        Calorie values are approximate recipe estimates.
      </p>
    </div>
  );
}
