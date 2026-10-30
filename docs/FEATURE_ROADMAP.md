# KitchenSync — Living feature roadmap

This file is updated whenever the team proposes a new idea. Record the problem, users, dependencies, acceptance test, and development milestone before implementing it. No feature is silently considered complete merely because an interface mockup exists.

## Original hackathon PDF baseline
1. Weekly breakfast/lunch/dinner planner.
2. Recipe library with household-size ingredient scaling.
3. Kitchen inventory with proper units.
4. Daily and weekly stock check and shortage alerts.
5. Mark cooked, auto-deduct stock.
6. Grocery shopping list and quick-commerce hand-off.

## User-approved must-haves (12)
| # | Feature | v0.1 starter state | Next step |
|---|---|---|---|
| 1 | Weekly meal planner | Functional (create/edit/remove; meal-specific eaters) | Drag/drop and AI plans |
| 2 | Recipe library | 8 sample Indian recipes | User recipes, verified external recipe search |
| 3 | Household-based quantities | Functional, scaling uses meal eaters | Individual member RSVP/preferences |
| 4 | Kitchen inventory | Functional CRUD and consistent units | Purchase history and batch/lot tracking |
| 5 | Today & week stock check | Functional: weekly ordered consumption; today visible in dashboard | Date-specific forecasting and batch priority |
| 6 | Missing ingredient alerts | Functional on screen | Browser/email/voice proactive alerts |
| 7 | Shopping list | Functional and copyable | True quick-commerce cart hand-off |
| 8 | Auto stock deduction | Functional, atomic transaction, prevents double debit | Portion adjustments and meal cancellation reconciliation |
| 9 | Meal calorie calculator | Approximate per-serving figure scaled for people | Nutritional calculation from verified ingredients |
| 10 | Expiry tracking | Dates, warnings and exclusion of expired stock | Lot-aware expiry, reminders and food safety guidance |
| 11 | Grocery price comparison | NOT BUILT | Integrate real providers; verify timestamp, location and pack size |
| 12 | Voice-guided recipe steps | Browser text-to-speech and optional voice commands, English only | Hindi/local-language guidance, timers and questions |

## Additional user ideas
- **AI orchestrator**: user intention + inventory + dietary preferences + external recipe providers. **Not yet built.** v0.1 uses transparent offline ranking of bundled recipes.
- **Leftover utilization**: two sample reuse recipes, safe-storage checks on leftover inventory; no auto leftover suggestions based on past meals yet.
- **Receipt QR/barcode/OCR ingestion**: **Not built**. Note that a payment QR may not contain purchased product line items; support OCR and confirmation.
- **Family-wide roles and absences**: household size and each meal's attendees are adjustable; individual accounts/roles are not yet built.
- **True quick-commerce shopping hand-off**: copy list, open store; automated cart via supported APIs is **not built**.
- **Beginner-friendly preparation**: step-by-step English demo instructions; future utensil guidance, Hindi voice and safe timers.

## Safe implementation rules
- Calculations (stock, price totals, scaling and nutrients) use validated code, **not** LLM-generated arithmetic.
- No claims about live prices unless timestamped, appropriately sourced and verified.
- No claim of food safety based solely on age or expiry date; include storage questions and precautions.
- No remote submission or order without explicit user approval.
- Marking a meal done must be idempotent: never deduct twice.
- Keep new feature adapters separate (e.g. recipe_provider, receipt_parser, grocery_provider, voice_service).
- Avoid retaining scans, household details and purchase history longer than necessary; add auth and security before public hosting.

## Suggested implementation order
1. **Milestone A — integrated local flow** (starter): add stock → plan meal → calculate shortage → shopping list → mark cooked → decrease stock.
2. **Milestone B — genuine AI cooking assistant**: tools, trustworthy sources, chat memory within session, ingredient swaps, safe leftover suggestions and beginner Q&A.
3. **Milestone C — input automation**: bill OCR, QR/barcode checks, family participation, reminders, lot-aware expiry and nutritional calculations.
4. **Milestone D — live commerce**: provider partnership/API, verified price/pack size, store availability and explicit purchase confirmation.
5. **Milestone E — polish and testing**: voice localization, responsive UI, adversarial test scenarios, demo script and deployment.

## Template for each new idea
- **Idea:**
- **Whose problem does it solve?**
- **User flow:**
- **Backend/data/API changes:**
- **Does it change stock/nutrition/food-safety calculations?**
- **Acceptance test:**
- **Priority / owner / milestone:**
