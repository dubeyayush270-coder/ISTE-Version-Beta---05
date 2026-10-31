
import { useState } from "react";
import { api } from "../lib/api";
import TimedCookingGuide from "./TimedCookingGuide";

function formatTime(value) {
  if (!value) return "Time not available";

  const match = String(value).match(
    /^PT(?:(\d+)H)?(?:(\d+)M)?$/i
  );

  if (!match) return String(value);

  const minutes =
    Number(match[1] || 0) * 60 +
    Number(match[2] || 0);

  return `${minutes} minutes`;
}

function displayText(value) {
  if (typeof value === "string") return value;

  if (value && typeof value === "object") {
    return String(
      value.text ||
      value.name ||
      JSON.stringify(value)
    );
  }

  return String(value ?? "");
}

// Convert AI recipe instructions into the format expected
// by KitchenSync's existing Smart Timed Cooking Guide.
//
// The two-minute durations are DEMO ESTIMATES.
// They are not verified cooking or food-safety times.
function makeAiCookingTimeline(recipe) {
  const instructions = Array.isArray(recipe?.instructions)
    ? recipe.instructions
    : [];

  const steps = instructions
    .map(displayText)
    .map(text => text.trim())
    .filter(Boolean);

  const durationSeconds = 120;

  return steps.map((instruction, index) => {
    const startMinutes = index * 2;
    const endMinutes = (index + 1) * 2;

    return {
      title: `Step ${index + 1} · ${startMinutes}:00–${endMinutes}:00 (estimated)`,

      instruction,

      durationSeconds,

      reminders: [
        {
          at: 60,
          message:
            "Check your progress and follow the original recipe instructions."
        }
      ],

      question: "Have you finished this step?",

      hint:
        "Confirm the step is complete before continuing. " +
        "Follow the original recipe's cooking and food-safety instructions."
    };
  });
}

export default function AIRecipeFinder() {
  const [mode, setMode] = useState("everyday");
  const [foodType, setFoodType] = useState("vegetarian");
  const [excluded, setExcluded] = useState("");
  const [minutes, setMinutes] = useState("60");

  const [recipes, setRecipes] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Currently selected AI recipe for Smart Timed Cooking.
  const [activeCooking, setActiveCooking] = useState(null);

  async function findRecipes(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setRecipes([]);
    setSearched(false);

    try {
      const response = await api("/ai/recommend", {
        method: "POST",
        body: JSON.stringify({
          mode,
          food_type: foodType,

          exclude: excluded
            .split(",")
            .map(item => item.trim())
            .filter(Boolean),

          cooking_time: minutes
            ? Number(minutes)
            : null,

          max_results: 10
        })
      });

      if (!Array.isArray(response.recipes)) {
        throw new Error("Unexpected recipe response");
      }

      setRecipes(response.recipes);
      setSearched(true);
    } catch (err) {
      setError(err.message || "Unable to load recipes.");
    } finally {
      setLoading(false);
    }
  }

  function startSmartCooking(recipe) {
    const timeline = makeAiCookingTimeline(recipe);

    if (timeline.length === 0) {
      setError(
        "This recipe does not contain usable cooking instructions."
      );
      return;
    }

    setError("");

    setActiveCooking({
      name: recipe.title || "AI Recipe",
      timeline
    });
  }

  function closeSmartCooking() {
    setActiveCooking(null);
  }

  return (
    <section className="k-card p-5 md:p-7 max-w-4xl mb-5">
      {/* Page heading */}
      <div className="mb-5">
        <p className="text-xs font-bold text-[#38865c] uppercase tracking-wider">
          Online recipe discovery
        </p>

        <h2 className="text-xl font-bold text-[#233b2d] mt-2">
          Find Recipes with KitchenSync AI
        </h2>

        <p className="text-sm text-[#738878] mt-2">
          Discover recipes from real cooking websites,
          filtered by your preferences.
        </p>
      </div>

      {/* AI recipe search form */}
      <form
        onSubmit={findRecipes}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-sm font-semibold">
            Recipe mode

            <select
              className="k-field w-full mt-2"
              value={mode}
              onChange={event => setMode(event.target.value)}
            >
              <option value="everyday">
                Everyday Healthy
              </option>

              <option value="kids_tiffin">
                Kids Tiffin
              </option>

              <option value="fitness">
                Fitness
              </option>

              <option value="budget">
                Budget Friendly
              </option>
            </select>
          </label>

          <label className="text-sm font-semibold">
            Food preference

            <select
              className="k-field w-full mt-2"
              value={foodType}
              onChange={event => setFoodType(event.target.value)}
            >
              <option value="vegetarian">
                Vegetarian
              </option>

              <option value="any">
                Any
              </option>
            </select>
          </label>

          <label className="text-sm font-semibold">
            Exclude ingredients

            <input
              className="k-field w-full mt-2"
              value={excluded}
              onChange={event => setExcluded(event.target.value)}
              placeholder="e.g. onion, garlic, peanuts"
            />
          </label>

          <label className="text-sm font-semibold">
            Maximum total time (minutes)

            <input
              className="k-field w-full mt-2"
              type="number"
              min="1"
              max="240"
              required
              value={minutes}
              onChange={event => setMinutes(event.target.value)}
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="k-button k-primary w-full"
        >
          {loading
            ? "Searching recipe websites..."
            : "Find AI Recipes"}
        </button>
      </form>

      {/* API errors */}
      {error && (
        <p
          role="alert"
          className="text-red-600 text-sm mt-4"
        >
          {error}
        </p>
      )}

      {/* Empty results */}
      {searched && !loading && recipes.length === 0 && (
        <p className="text-sm text-[#738878] mt-5">
          No recipes matched your preferences.
          Try a longer cooking time or fewer exclusions.
        </p>
      )}

      {/* AI recipe results */}
      {recipes.length > 0 && (
        <div className="mt-6 space-y-4">
          <h3 className="font-bold">
            {recipes.length} Recipes Found
          </h3>

          {recipes.map((recipe, index) => {
            const hasInstructions =
              Array.isArray(recipe.instructions) &&
              recipe.instructions.some(
                item => displayText(item).trim().length > 0
              );

            return (
              <article
                key={`${recipe.url || recipe.title}-${index}`}
                className="rounded-2xl border border-[#e2ece3] bg-white p-4"
              >
                {/* Recipe title */}
                <h4 className="font-bold text-[#244d35]">
                  {recipe.title || "Untitled recipe"}
                </h4>

                {/* Original website cooking information */}
                <p className="text-sm text-[#6b8673] mt-2">
                  Cooking information:{" "}
                  {formatTime(recipe.cooking_time)}
                </p>

                {/* Ingredients and original instructions */}
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-semibold">
                    View ingredients and instructions
                  </summary>

                  <div className="mt-3">
                    <p className="font-semibold mb-2">
                      Ingredients
                    </p>

                    <ul className="list-disc pl-5 space-y-1">
                      {(recipe.ingredients || []).map(
                        (item, i) => (
                          <li key={i}>
                            {displayText(item)}
                          </li>
                        )
                      )}
                    </ul>

                    <p className="font-semibold mt-4 mb-2">
                      Instructions
                    </p>

                    <ol className="list-decimal pl-5 space-y-2">
                      {(recipe.instructions || []).map(
                        (step, i) => (
                          <li key={i}>
                            {displayText(step)}
                          </li>
                        )
                      )}
                    </ol>
                  </div>
                </details>

                {/* Smart Timed Cooking entry point */}
                {hasInstructions && (
                  <div className="mt-4">
                    <button
                      type="button"
                      className="k-button k-primary w-full"
                      onClick={() => startSmartCooking(recipe)}
                    >
                      Start Smart Timed Cooking
                    </button>

                    <p className="text-xs text-[#738878] mt-2">
                      Includes estimated step timestamps,
                      countdown timers, voice guidance,
                      and progress reminders.
                    </p>
                  </div>
                )}

                {/* Original recipe website link */}
                {/^https?:\/\//i.test(recipe.url || "") && (
                  <a
                    href={recipe.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-4 text-sm font-bold text-[#31845a] underline"
                  >
                    Open original recipe
                  </a>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Source and cooking-time disclaimer */}
      <p className="text-xs text-[#8a968a] mt-4">
        Results come from external recipe websites.
        Check ingredients and cooking instructions before use.
        Smart Cooking timers use approximate two-minute
        checkpoints per step unless recipe-specific timings
        are provided elsewhere. These timers are not
        food-safety guarantees.
      </p>

      {/* Shared countdown timer and voice assistant */}
      {activeCooking && (
        <TimedCookingGuide
          recipeName={activeCooking.name}
          timeline={activeCooking.timeline}
          onClose={closeSmartCooking}
        />
      )}
    </section>
  );
}
