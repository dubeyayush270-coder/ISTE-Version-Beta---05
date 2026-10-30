
import { useEffect, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  UsersRound,
  Plus,
  CheckCircle2,
  AlertTriangle,
  ShoppingBasket,
  Flame
} from "lucide-react";

import "./MobileMealPlanner.css";

const MEALS = [
  { id: "breakfast", name: "Breakfast", emoji: "🥣" },
  { id: "lunch", name: "Lunch", emoji: "🍛" },
  { id: "dinner", name: "Dinner", emoji: "🍲" }
];

function todayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDay(date, options) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(
    "en-IN",
    options
  );
}

export default function MobileMealPlanner({
  dates,
  plan,
  recipes,
  audit,
  onPlan,
  onViewRecipe,
  onWeekChange,
  onThisWeek,
  onShopping
}) {
  const [selectedDay, setSelectedDay] = useState(todayLocal());

  useEffect(() => {
    setSelectedDay(current =>
      dates.includes(current)
        ? current
        : dates.includes(todayLocal())
          ? todayLocal()
          : dates[0]
    );
  }, [dates]);

  const dayMeals = plan.filter(
    meal => meal.meal_date === selectedDay
  );

  const warnings = (audit?.warnings || []).filter(
    warning => warning.date === selectedDay
  );

  const totalCalories = dayMeals.reduce((total, meal) => {
    const recipe = recipes.find(r => r.id === meal.recipe_id);

    return total + (
      recipe
        ? recipe.calories_per_serving * meal.eaters
        : 0
    );
  }, 0);

  const cookedCount = dayMeals.filter(
    meal => Boolean(meal.completed_at)
  ).length;

  const formatQuantity = (value, unit) =>
    `${Number(value.toFixed(2))} ${unit}`;

  return (
    <div className="ksmp">
      <div className="ksmp-heading">
        <div>
          <p className="ksmp-eyebrow">PLAN YOUR WEEK</p>
          <h1>Meal Planner 🌿</h1>
          <p className="ksmp-muted">
            Healthy meals, happy family.
          </p>
        </div>
        <div className="ksmp-heading-icon">
          <CalendarDays size={23} />
        </div>
      </div>

      <div className="ksmp-weekbar">
        <button
          type="button"
          onClick={() => onWeekChange(-1)}
          aria-label="Previous week"
        >
          <ChevronLeft size={19} />
        </button>

        <div>
          <strong>
            {formatDay(dates[0], {
              day: "numeric",
              month: "short"
            })}
            {" – "}
            {formatDay(dates[6], {
              day: "numeric",
              month: "short"
            })}
          </strong>
          <button
            type="button"
            className="ksmp-this-week"
            onClick={onThisWeek}
          >
            This week
          </button>
        </div>

        <button
          type="button"
          onClick={() => onWeekChange(1)}
          aria-label="Next week"
        >
          <ChevronRight size={19} />
        </button>
      </div>

      <div className="ksmp-days" aria-label="Select a day">
        {dates.map(date => {
          const active = date === selectedDay;
          const today = date === todayLocal();

          return (
            <button
              type="button"
              key={date}
              className={`ksmp-day ${active ? "active" : ""}`}
              onClick={() => setSelectedDay(date)}
              aria-pressed={active}
            >
              <span>
                {formatDay(date, { weekday: "short" })}
              </span>
              <strong>
                {formatDay(date, { day: "numeric" })}
              </strong>
              <i className={today ? "today-dot" : ""} />
            </button>
          );
        })}
      </div>

      <div className="ksmp-summary">
        <div>
          <p className="ksmp-muted">
            {formatDay(selectedDay, {
              weekday: "long",
              day: "numeric",
              month: "long"
            })}
          </p>
          <h2>Today's Menu</h2>
        </div>

        <span className="ksmp-counter">
          {cookedCount}/{dayMeals.length} cooked
        </span>
      </div>

      <div className="ksmp-meals">
        {MEALS.map(slot => {
          const meal = dayMeals.find(
            item => item.meal_type === slot.id
          );

          const recipe = recipes.find(
            item => item.id === meal?.recipe_id
          );

          return (
            <div className="ksmp-meal" key={slot.id}>
              <div className="ksmp-food-icon">
                {slot.emoji}
              </div>

              <div className="ksmp-meal-info">
                <span>{slot.name}</span>
                <strong>
                  {meal?.recipe_name || "Not planned yet"}
                </strong>

                {meal ? (
                  <div className="ksmp-meta">
                    <span>
                      <Clock3 size={12} />
                      {meal.minutes} min
                    </span>
                    <span>
                      <UsersRound size={12} />
                      {meal.eaters} people
                    </span>
                  </div>
                ) : (
                  <small>Tap + to choose a recipe</small>
                )}
              </div>

              {meal?.completed_at ? (
                <button
                  type="button"
                  className="ksmp-completed"
                  aria-label={`View cooked ${slot.name}`}
                  onClick={() => onViewRecipe(meal.recipe_id)}
                >
                  <CheckCircle2 size={22} />
                </button>
              ) : (
                <button
                  type="button"
                  className="ksmp-add"
                  aria-label={
                    meal
                      ? `Edit ${slot.name}`
                      : `Plan ${slot.name}`
                  }
                  onClick={() => onPlan(selectedDay, slot.id)}
                >
                  {meal ? (
                    <ChevronRight size={21} />
                  ) : (
                    <Plus size={21} />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="ksmp-calories">
        <Flame size={20} />
        <div>
          <strong>~{Math.round(totalCalories)} kcal</strong>
          <span>Estimated household meal total</span>
        </div>
      </div>

      <div className="ksmp-stock">
        <div className="ksmp-stock-title">
          <h3>Ingredient Availability</h3>
          <ShoppingBasket size={20} />
        </div>

        {dayMeals.length === 0 ? (
          <p className="ksmp-stock-ok">
            Plan a meal to check kitchen stock.
          </p>
        ) : warnings.length === 0 ? (
          <p className="ksmp-stock-ok">
            <CheckCircle2 size={18} />
            All planned meals have enough tracked ingredients.
          </p>
        ) : (
          <>
            <p className="ksmp-stock-warning">
              <AlertTriangle size={18} />
              {warnings.length} ingredient shortage alerts
            </p>

            {warnings.slice(0, 4).map((item, index) => (
              <div className="ksmp-shortage" key={index}>
                <span>{item.ingredient}</span>
                <strong>
                  Need {formatQuantity(
                    item.missing,
                    item.unit
                  )}
                </strong>
              </div>
            ))}

            <button
              type="button"
              className="ksmp-shop-button"
              onClick={onShopping}
            >
              Open Shopping List
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>

      <p className="ksmp-disclaimer">
        Calories and recipe quantities are illustrative estimates.
      </p>
    </div>
  );
}
