KITCHENSYNC — UI/UX POLISH | JUDGE FEEDBACK FIXES

This ZIP contains COMPLETE replacement versions of only the eight files listed below.
Extract the ZIP into D:\Downloads\KitchenSync\frontend (not into the src folder).
The archive has src/ paths matching your actual React project.

FILES
src/App.jsx
src/main.jsx
src/ui-polish.css (new)
src/components/MobileDashboard.jsx
src/components/MobilePantry.jsx
src/components/MobileShopping.jsx
src/components/QuickCommerceHandoff.jsx
src/components/WeeklyPlanGenerator.css

WHAT CHANGED
- Mobile navigation: Back arrow + More drawer containing only extra sections; main five sections remain in bottom tabs.
- Family/household modal: Back control, above bottom tabs, usable scroll height.
- Dashboard: Remove redundant route button, keep expiry stat linked to Expiring Pantry filter.
- Text: 'Freshness alerts/review' -> 'Expiry alerts/review'; larger mobile text and touch controls.
- Pantry: Primary Scan/Add controls now near the top. Each item keeps Manage batches;
  secondary Audit/Edit/Delete live under More actions instead of four adjacent buttons.
- Shopping: One Copy list action; no duplicate quick-commerce checklist/copy button;
  purchase checkmark remains browser-only, actual Pantry stock changes ONLY on Record purchase.
  The recorded purchase also clears a stale checklist checkmark for the same ingredient.
- Quick commerce and manual Price Comparison: collapsible cards instead of huge always-open forms.
  Price comparison remains MANUAL; no claims of live store pricing.
- Mark cooked: explicit 'Mark cooked & deduct stock' button, confirmation and disabled
  in-flight state; already completed meals show their completed state.
- Weekly preview: mobile confirmation footer can scroll without hiding entire meal list.
- Scanner, Family Management, Recipe Detail, database, and backend files are untouched.

INSTALL (PowerShell)
1) Back up the current UI first:
   cd D:\Downloads\KitchenSync
   Compress-Archive -Path .\frontend\src -DestinationPath .\KitchenSync-UI-before-polish.zip -Force

2) Download this ZIP to your Windows Downloads folder. Then run:
   Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\KitchenSync-UI-Polished.zip" -DestinationPath "D:\Downloads\KitchenSync\frontend" -Force

3) Verify:
   cd D:\Downloads\KitchenSync\frontend
   npm.cmd run build
   node --test .\src\lib\familyAttendanceMode.test.mjs .\src\lib\familyDiet.test.mjs .\src\lib\familyProfile.test.mjs .\src\lib\planServingLogic.test.mjs .\src\lib\priceUtils.test.mjs .\src\lib\shoppingUtils.test.mjs

4) Run your normal frontend and test screens at phone size.

THIS ZIP DOES NOT commit, push, merge or modify backend code.
Original source snapshot: the KitchenSync-UI.zip you supplied in chat.
Verified here: all 19 JSX files parse and the 11 frontend utility test cases pass.
NOT verified here: full Vite build (node_modules not included), live backend interactions,
physical mobile screens or camera scanning. Please run the commands above.
