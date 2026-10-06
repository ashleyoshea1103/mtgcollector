# mtgcollector

A web app for keeping an inventory of a Magic: The Gathering collection. It finds cards with [Scryfall](https://scryfall.com/docs/api), shows Cardmarket (EUR) prices, and groups cards automatically (by set, color, type, rarity or mana value) or into your own binders, decks and boxes.

## Stack
- **frontend/**: React, Vite and TypeScript
- **backend/**: Go and PostgreSQL (coming soon)

## Development
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173/dev/components to see the component gallery.

## Workflow
- `main` holds releases and `develop` is where work is integrated.
- Each feature is built on a `feature/<name>` branch and merged into `develop` by pull request.
