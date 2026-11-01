KitchenSync - weekly planner + family attendance automatic update

Why an updater instead of prewritten replacements?
The three current source files are untracked, local-only files on your Windows PC.
A full replacement assembled without reading those exact files could delete the
existing 21-meal generator, preview, replace, save, and completed-meal protections.
This updater reads the actual three files, preserves unrelated code, and writes
the full updated versions directly on your computer.

HOW TO USE
1. Unzip this archive, copy Update-KitchenSync-WeeklyPlanner.py into:
   D:\Downloads\KitchenSync\
2. Open PowerShell in D:\Downloads\KitchenSync
3. Run:
   .\.venv\Scripts\python.exe .\Update-KitchenSync-WeeklyPlanner.py
4. If it says SUCCESS, run:
   .\.venv\Scripts\python.exe -m unittest discover -s tests -v
   cd frontend
   npm.cmd run build

The updater modifies exactly these three project source files:
  frontend/src/components/WeeklyPlanGenerator.jsx
  backend/weekly_planner_api.py
  backend/weekly_planner.py

It backs up each existing file next to the original with a timestamped .bak
suffix. It checks all patch anchors and Python syntax before touching any of
the originals. It does not stage, commit, push, merge, or reset Git.

New behavior:
  - Five weekly diet selections including Any Recipe.
  - Uses Family Management attendance when enabled, and household size when off.
  - Uses strictest attending dietary choice for each date/meal.
  - Enforces today's family preferences on Replace and Save.
  - Does not alter completed meals.
  - Stops generation clearly if 0 attendees for any requested slot, because the
    existing meal_plan schema requires at least 1 eater per saved meal.
  - Dietary checks are best-effort from ingredient names, not allergy guarantees.

If the script says STOPPED SAFELY: no existing source files were modified.
Share the exact error text; the file's layout differs from the known version.
