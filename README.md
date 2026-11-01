
# 🍽️ KitchenSync — AI-Powered Smart Kitchen Assistant

### Plan Smarter. Eat Healthier. Waste Less.

**KitchenSync** is an AI-powered Indian household kitchen management platform designed to simplify meal planning, grocery management, cooking, and everyday kitchen decisions.

From planning meals to tracking groceries and reducing food waste, KitchenSync brings your entire kitchen experience together in one smart application.

## 🚀 Experience KitchenSync

### 🌐 Live Website
**Explore KitchenSync directly in your browser.**

👉 **[Launch KitchenSync Web App](https://iste-version-beta-05.onrender.com/)**

### 📱 Android Application
**Take your smart kitchen assistant wherever you go.**

👉 **[📱 Download KitchenSync APK](https://drive.google.com/uc?export=download&id=1WjYaNaAxn6FoDkJysNCrIXOriIpWYOSN)**

> **Note:** The Android APK is distributed through Google Drive. You may be asked to confirm the download or installation.

---

## 🛠️ Tech stack


## Tech stack

- React 19 + Vite 7 + Tailwind CSS 4; icon components via lucide-react
- FastAPI (Python), SQLite and Python unit tests
- Browser speech synthesis and optional browser speech recognition (English)
- Vite dev server proxies `/api` requests to FastAPI, so separate CORS configuration is unnecessary for local development.

## Requirements

- Windows 10/11; VS Code recommended
- Python 3.11+ installed (3.12 or 3.13 preferred if available)
- **Node.js 20.19+ or 22.12+** (`node -v`); a current maintained LTS is recommended.

## Start locally (two PowerShell terminals)

Extract the project ZIP and open the **KitchenSync-React** folder in VS Code. Run one command at a time.

**Terminal 1 — Backend**, from `KitchenSync-React`:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app:app --app-dir backend --reload --port 8000
```

Verify `http://127.0.0.1:8000/api/health` reports `{"status":"ok","version":"0.2.0"}`.

**Terminal 2 — React frontend**, also from `KitchenSync-React`:

```powershell
cd frontend
npm install
npm run dev
```

Open **http://127.0.0.1:5173/** to see KitchenSync in React. **Do not use port 8000 for the React development site** (port 8000 serves API endpoints).

To stop either server, press `Ctrl+C` in its terminal. You must keep both servers running during development.

If PowerShell blocks the `npm` script, use `npm.cmd install` and `npm.cmd run dev` instead, or use Command Prompt. If Node is too old, update it first.

## Current feature checklist

| Area | Current implementation |
| --- | --- |
| Dashboard | Household stats, today's 3 meals, expiry and shortage alerts |
| Weekly planning | Breakfast/lunch/dinner, per-meal attendee count, 7-day navigation |
| Recipe library | 8 illustrative Indian recipes, search, scaled ingredients and cooking steps |
| Inventory | Add/edit/delete, expiry, leftover metadata, g/ml/piece units |
| Stock checks | Chronological daily/weekly shortage simulation, skip completed meals |
| Cooking completion | Atomic stock deduction only if ingredients available, block double deduction |
| Shopping list | Aggregate missing ingredients, clipboard hand-off to grocery app |
| Calories | **Sample estimates**, not verified nutritional calculations |
| Voice guide | English step narration using browser text-to-speech; optional spoken navigation in supported browsers |
| Smart recipe finder | **Rule-based ranking of existing recipes**, not yet an external AI assistant |
| Live price comparison | **Planned, not yet connected** |
| Receipts/barcodes/QR | **Planned, not yet connected** |
| External AI recipe search and Hindi dialogue | **Planned, not yet connected** |
| Advanced leftover suggestions | **Planned**; basic leftover recipes and storage checks included |

**Important:** A payment QR code typically does not identify bill line items. Receipt processing will need verifiable machine-readable items or OCR with user review. Food safety and nutrition must not be based on unverified assumptions.

## Quick demo scenario

1. Open `http://127.0.0.1:5173/`; sample pantry and meals are already populated.
2. Open **Meal planner** and change tomorrow's lunch to 2 eaters; save.
3. Check the weekly shortage list below the planner, then **Shopping list**.
4. Open **My pantry**, edit an ingredient quantity, then see alerts change.
5. In the planner, click today's breakfast and choose **Mark cooked**. Notice stock quantities decrease once.
6. Open **Recipe library** -> select a recipe -> **Start voice guide**.
7. Search **Kitchen assistant** for `spicy`, `rice` or `leftovers` to try the offline suggestions.
8. See **Feature roadmap** for known incomplete capabilities.

## Run backend tests

```powershell
.\.venv\Scripts\python.exe -m pip install httpx
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## Build a static production frontend

With Node dependencies installed:

```powershell
cd frontend
npm run build
cd ..
```

When `frontend/dist` exists, FastAPI serves the built frontend at `http://127.0.0.1:8000/`. This is **not ready for public hosting**: user accounts, authorization, secrets management and deployment protection are not implemented.

## Project layout

```text
KitchenSync-React/
  frontend/
    index.html
    package.json
    vite.config.js
    src/
      App.jsx          # Connected React UI and interactions
      index.css        # Tailwind CSS + small reusable design classes
      main.jsx         # React entrypoint
      lib/api.js       # Fetch wrapper, dates and recipe calculations
  backend/
    app.py             # FastAPI routes and React build serving
    core.py            # Deterministic stock and recipe quantity logic
    db.py              # SQLite initialization and seed data
    catalog.py         # Sample Indian recipes
  tests/test_core.py
  docs/FEATURE_ROADMAP.md
  requirements.txt
```

## Verification status

- Backend tests: **8/8 passed** in the build environment.
- Frontend source: React/JSX files were **syntax-checked** with TypeScript's parser.
- Frontend package install/build: **could not be verified here** because the environment's npm dependency download timed out. Run `npm install` and `npm run dev` on your laptop to verify the real browser experience.

## Hackathon repo discipline

Use the assigned **team ID** as GitHub repository name and add the organizer's account specified in your problem-statement PDF. Push at least one meaningful commit every six hours per the provided guidelines. Never commit `.env`, private receipt scans, local personal data, `node_modules`, or your SQLite data file.
=======
# ISTE-Version-Beta---05
>>>>>>> origin/main
