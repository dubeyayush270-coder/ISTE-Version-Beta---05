# React migration — v0.2

- Replaced the starter's DOM-manipulation frontend with React + Vite + Tailwind CSS.
- Preserved existing FastAPI data contract and deterministic stock simulation.
- Added Vite proxy to API in development; FastAPI optionally serves built dist.
- New components in App.jsx cover dashboard, planning, inventory CRUD, shopping, recipe guide, offline suggestions, and roadmap.
- Advanced receipt, grocery price, LLM recipe search and voice conversation features are deliberately flagged as future integrations.
- Add new ideas to FEATURE_ROADMAP.md, define data/api changes, implement UI, test edge cases, then mark status.
