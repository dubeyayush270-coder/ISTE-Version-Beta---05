KitchenSync Smart Weekly Planner + Fitness Update (2026-11-01)
============================================================

This ZIP contains COMPLETE updated source files, based on the latest source uploaded in this chat.
It does NOT include the database, temporary test stubs, package-lock, secrets, or binary assets.

REPLACE IN THE KITCHENSYNC PROJECT ROOT:
  backend/app.py
  backend/db.py
  backend/weekly_planner.py
  backend/weekly_planner_api.py
  backend/online_recipes_api.py
  backend/recipe_nutrition_api.py       (new)
  frontend/src/components/WeeklyPlanGenerator.jsx
  frontend/src/components/WeeklyPlanGenerator.css
  frontend/src/components/OnlineRecipeDiscovery.jsx
  tests/test_weekly_nutrition.py       (new)
  tests/test_nutrition_routes.py        (new)

INSTALL (PowerShell; adjust the ZIP location if necessary):
  cd D:\Downloads\KitchenSync
  Compress-Archive -Path .\backend, .\frontend\src, .\tests -DestinationPath .\Before-Fitness-Update.zip -Force
  Expand-Archive -LiteralPath 'D:\Downloads\KitchenSync-SmartPlanner-Fitness.zip' -DestinationPath 'D:\Downloads\KitchenSync' -Force

TEST:
  cd D:\Downloads\KitchenSync
  .\.venv\Scripts\python.exe -m unittest discover -s tests -v
  cd frontend
  npm.cmd run build

WHAT'S NEW:
  - Goal modes: Balanced & varied, High protein, My calorie target (per person/day)
  - Per-serving calories, protein, carbs, and fat; honest missing-value indicators
  - User review/edit nutrition for saved recipes; optional nutrition input at online import
  - Per-day calorie and macro summary (assumes all three meals eaten by one person)
  - Lock individual uncompleted meals and regenerate only unlocked meals
  - Explanations for suggested meals using actual tracked Pantry data
  - Separate weekday/weekend cooking-time preferences
  - Optional weekly budget goal (ADVISORY ONLY; price data absent)
  - Online recipe quantity prefill for safe exact units, countable pieces, standard spoons
  - Automatic future-leftover suggestions excluded; existing recorded leftovers only
  - Preserve Family Management, actual meal servings, cooking completion protection

IMPORTANT LIMITATIONS:
  - Nutrition values from the seeded recipe catalog are illustrative calories,
    NOT medically verified nutrition. Protein/carbs/fat start as unknown until reviewed.
  - TheMealDB does not guarantee macros or original serving counts. User must confirm
    the original base serving count and unconvertible ingredient amounts.
  - Spoon units are converted into ml as volume. Never interpret as grams/density.
  - Weekly budget cannot be enforced until authenticated ingredient-price data exists.
  - Zero-attendee weekly slots cannot yet be saved as zero-serving meals because the
    existing meal_plan table restricts eaters to 1..30. Choose an attendee or edit
    that slot in Family Management before generating a complete 21-slot week.
  - API and UI changes from other teammates after this uploaded source may conflict;
    compare if newer local modifications have been made.
  - No data is sent to external nutrition APIs; online recipe discovery keeps using
    the existing TheMealDB source. No auto-created leftovers, no Pantry deductions
    on preview, regeneration, or import.

TEST STATUS IN THIS ENVIRONMENT:
  - 68 backend unittest cases passed using a temporary stub for missing optional
    'ddgs' search dependency. Tests did NOT connect to online recipe websites.
  - Python compileall successful.
  - Both changed JSX components passed TypeScript JSX syntax transpilation.
  - Full Vite build was NOT run here: offline npm package cache was incomplete.
  - You MUST run the full test and build commands locally before a Git commit/push.

No commits, pushes or merges are performed by this ZIP.
