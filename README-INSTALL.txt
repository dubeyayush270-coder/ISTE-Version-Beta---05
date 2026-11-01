KitchenSync: Saved + Online Recipes + User Editable Weekly Schedule
==================================================================

This archive contains FIVE complete source files, relative to your project root:
  backend/app.py
  backend/online_recipes_api.py                (NEW)
  frontend/src/components/WeeklyPlanGenerator.jsx
  frontend/src/components/OnlineRecipeDiscovery.jsx  (NEW)
  frontend/src/components/WeeklyPlanGenerator.css

BACK UP FIRST. The app.py replacement is based on the full app.py previously
uploaded in this conversation after the Family Management/Weekly Planner merge.
If you or your teammates have edited app.py since that upload, compare changes
before overwriting it. Existing Audit Stock, scanner and family source files are
not included in this update.

Installation (PowerShell):
  cd D:\Downloads\KitchenSync
  Compress-Archive -Path .\backend\app.py,.\frontend\src\components\WeeklyPlanGenerator.jsx,.\frontend\src\components\WeeklyPlanGenerator.css -DestinationPath .\before-saved-online-update.zip -Force
  Expand-Archive -LiteralPath 'D:\Downloads\KitchenSync-Saved-Online-Editable-Week.zip' -DestinationPath 'D:\Downloads\KitchenSync' -Force

Verification:
  .\.venv\Scripts\python.exe -m py_compile backend\app.py backend\online_recipes_api.py
  .\.venv\Scripts\python.exe -m unittest discover -s tests -v
  cd frontend
  npm.cmd run build

Restart both backend and frontend after installing.

Usage:
  Meal Planner > Generate My Week
  > Tap 'Find online recipes' or Edit any uncooked meal > Find online
  > Search a recipe by name > Review ingredients, quantities, cooking time,
    servings and instructions > Confirm & Import
  > The imported recipe becomes an ordinary saved recipe and can be picked
    from a meal's 'Edit > Choose your recipe' dropdown.
  > Regenerate week to allow the algorithm to mix existing saved recipes
    with online recipes imported after review.
  > Preview and Confirm & Save.
  > Individual saved meals can also be edited or removed using the existing
    Planner meal controls. Cooked meals stay locked.

SAFETY / LIMITATIONS:
  - This is a review-first online integration, NOT automatic live web recipes
    silently inserted into a 21-meal plan. User-confirmed imports are needed
    because TheMealDB data does not always specify reliable g/ml/pcs amounts.
  - Preview, search and import do not add leftovers, deduct stock or complete
    meals. Import adds a RECIPE to the local library only.
  - Only real, separately recorded leftovers are relevant to Pantry planning.
  - The existing weekly-plan save endpoint remains authoritative for family
    attendance, dietary rules, 21 slots, and completed-meal protection.
  - Recipe nutrition is set to 0 (unknown) on online imports; never represent
    this as measured nutritional data.
  - TheMealDB's key '1' is documented for development/testing; a supporter
    key is needed before public app-store release. Internet required for search.
  - Nothing is committed, staged or pushed by this archive.

If the test suite fails, restore the backed-up three originals and remove
online_recipes_api.py and OnlineRecipeDiscovery.jsx; no database migration is
required for this feature.
