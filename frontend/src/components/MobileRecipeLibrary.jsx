
import { useMemo, useState } from "react";
import {
  Search,
  Clock3,
  Flame,
  UsersRound,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  ChefHat,
  X,
  PackageCheck
} from "lucide-react";

import { recipeIcon, scaleRecipe } from "../lib/api";
import "./MobileRecipeLibrary.css";

function RecipeArtwork({ recipe }) {
  const [failed, setFailed] = useState(false);

  // Display a real photo when an image URL is available.
  // Otherwise, use a food illustration/emoji.
  const image = recipe.image_url || recipe.photo_url;

  return (
    <div className="ksrl-artwork">
      {image && !failed ? (
        <img
          src={image}
          alt={recipe.name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">
          {recipeIcon(recipe)}
        </span>
      )}
    </div>
  );
}

export default function MobileRecipeLibrary({
  recipes = [],
  inventory = [],
  householdSize = 2,
  onOpenRecipe,
  onNavigate
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  // Generate category filters from real recipe data.
  const categories = useMemo(() => [
    "All",
    ...new Set(
      recipes.map(recipe => recipe.category).filter(Boolean)
    )
  ], [recipes]);

  // Build a lookup of usable inventory.
  const pantry = useMemo(() => {
    const lookup = new Map();

    for (const item of inventory) {
      if (item.usable === false) continue;

      const key = `${item.name.trim().toLowerCase()}|${item.unit}`;

      lookup.set(
        key,
        (lookup.get(key) || 0) + Number(item.quantity || 0)
      );
    }

    return lookup;
  }, [inventory]);

  // Calculate approximate ingredient availability.
  const catalog = useMemo(() => {
    return recipes.map(recipe => {
      const ingredients = scaleRecipe(recipe, householdSize);

      const missing = ingredients.filter(ingredient => {
        const key =
          `${ingredient.name.trim().toLowerCase()}|${ingredient.unit}`;

        const available = pantry.get(key) || 0;

        return available < ingredient.quantity;
      });

      return {
        ...recipe,
        missingCount: missing.length,
        ready: missing.length === 0
      };
    });
  }, [recipes, householdSize, pantry]);

  const filteredRecipes = useMemo(() => {
    return catalog.filter(recipe => {
      const query = search.trim().toLowerCase();

      const searchable = [
        recipe.name,
        recipe.category,
        ...(recipe.tags || [])
      ].join(" ").toLowerCase();

      const matchesSearch =
        !query || searchable.includes(query);

      const matchesCategory =
        category === "All" || recipe.category === category;

      const matchesStock =
        !onlyAvailable || recipe.ready;

      return matchesSearch && matchesCategory && matchesStock;
    });
  }, [catalog, search, category, onlyAvailable]);

  const readyCount = catalog.filter(r => r.ready).length;

  return (
    <div className="ksrl">

      {/* Header */}
      <header className="ksrl-header">
        <div>
          <p className="ksrl-eyebrow">DISCOVER & COOK</p>
          <h1>Recipe Library 🌿</h1>
          <p>Discover something delicious today.</p>
        </div>

        <div className="ksrl-header-icon">
          <ChefHat size={24} />
        </div>
      </header>

      {/* Search */}
      <div className="ksrl-search">
        <Search size={20} />

        <input
          type="search"
          value={search}
          placeholder="Search recipes, ingredients..."
          onChange={event => setSearch(event.target.value)}
          aria-label="Search recipes"
        />

        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
          >
            <X size={17} />
          </button>
        )}
      </div>

      {/* Category filters */}
      <div className="ksrl-categories">
        {categories.map(item => (
          <button
            key={item}
            type="button"
            className={category === item ? "active" : ""}
            onClick={() => setCategory(item)}
            aria-pressed={category === item}
          >
            {item}
          </button>
        ))}
      </div>

      {/* Stock-aware filtering */}
      <div className="ksrl-availability">
        <div>
          <PackageCheck size={19} />
          <span>Only show recipes I can cook</span>
        </div>

        <button
          type="button"
          className={`ksrl-toggle ${onlyAvailable ? "on" : ""}`}
          role="switch"
          aria-checked={onlyAvailable}
          aria-label="Only show recipes with ingredients available"
          onClick={() => setOnlyAvailable(!onlyAvailable)}
        >
          <span />
        </button>
      </div>

      {/* Results summary */}
      <div className="ksrl-section-title">
        <div>
          <h2>Explore recipes</h2>
          <p>
            {filteredRecipes.length} recipes found
          </p>
        </div>

        <span className="ksrl-ready-count">
          {readyCount} pantry matches
        </span>
      </div>

      {/* Recipe cards */}
      <div className="ksrl-grid">
        {filteredRecipes.map(recipe => (
          <article className="ksrl-card" key={recipe.id}>

            <RecipeArtwork recipe={recipe} />

            <div className="ksrl-card-content">
              <span className="ksrl-category">
                {recipe.category}
              </span>

              <h3>{recipe.name}</h3>

              <div className="ksrl-meta">
                <span>
                  <Clock3 size={13} />
                  {recipe.minutes} min
                </span>

                <span>
                  <Flame size={13} />
                  ~{Math.round(recipe.calories_per_serving)} kcal
                </span>
              </div>

              <div className="ksrl-servings">
                <UsersRound size={13} />
                Calculated for {householdSize} people
              </div>

              <div className="ksrl-stock-status">
                {recipe.ready ? (
                  <span className="ready">
                    <CheckCircle2 size={14} />
                    Ingredients available
                  </span>
                ) : (
                  <span className="missing">
                    <AlertTriangle size={14} />
                    {recipe.missingCount} items missing
                  </span>
                )}
              </div>

              <button
                type="button"
                className="ksrl-view-button"
                onClick={() => onOpenRecipe(recipe)}
              >
                View & Cook
                <ArrowRight size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {filteredRecipes.length === 0 && (
        <div className="ksrl-empty">
          <ChefHat size={35} />
          <h3>No matching recipes</h3>
          <p>
            Try another search or change your filters.
          </p>
          <button
            onClick={() => {
              setSearch("");
              setCategory("All");
              setOnlyAvailable(false);
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* AI entry point */}
      <button
        type="button"
        className="ksrl-ai-banner"
        onClick={() => onNavigate("assistant")}
      >
        <span className="ksrl-ai-icon">
          <Sparkles size={24} />
        </span>

        <div>
          <strong>Cook with what you have</strong>
          <small>
            Discover meals based on your kitchen inventory
          </small>
        </div>

        <ArrowRight size={21} />
      </button>

      <p className="ksrl-disclaimer">
        Ingredient availability is an estimate based on tracked
        pantry quantities. Calories are approximate.
      </p>

    </div>
  );
}
