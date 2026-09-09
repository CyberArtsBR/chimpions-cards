# CHIMPIONS: Attribute Arena

An original competitive stat-battle game built around the official animated 1/1 Chimpions collection. It includes a deterministic game engine, offline CPU play, private real-time rooms, animated artwork fallbacks, responsive controls, and an official-gallery importer.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`. For online play, two players enter the same four-letter room code. The WebSocket server is authoritative: it owns the shuffled decks, hidden cards, timers, standoff pot, and outcomes.

## Data

`npm run import` downloads every official gallery page, validates and deduplicates the collection, then writes `public/data/chimpions.json`. The committed seed contains verified official cards so CPU mode remains playable if the gallery is unavailable. Current official API total observed: **221**.

This is an independent community game. Game stats are deterministic fictional gameplay values—not NFT rarity, market value, or financial advice. No token spending changes gameplay power.
