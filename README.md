# CHIMPIONS: Attribute Arena

Competitive Top-Trumps-style battles built around the animated Chimpions collection.

## What is implemented

- CPU matches with random initiative, explicit win/loss/draw endings, production state-machine validation, standoff-pot conservation, and distribution-aware CPU choices.
- Classic rules and an optional Tactical ruleset with alternating initiative, no immediate attribute repeat, and one reserve swap per player.
- Responsive arena with mobile-first touch targets, visible deck/pot/turn information, battle history, reveal/capture feedback, reduced-motion support, image fallbacks, and preloading.
- Procedural WebAudio music/SFX toggles with no external audio assets.
- Server-authoritative private 1v1 rooms with room validation, turn ownership, 20-second turn timeout, disconnect cleanup, illegal-action rejection, and shared rules with the CPU game.
- Production-engine tests, collection validation, and balance simulation.

## Collection data

`public/data/chimpions.json` is a checked-in fallback manifest. The official Chimpions site currently describes the collection as 222 unique pieces, so a production release should refresh the manifest before final balancing:

```bash
npm run import
npm run validate:collection:strict
npm run balance
```

The importer refuses to silently accept an incomplete collection unless `ALLOW_PARTIAL_IMPORT=1` is explicitly set.

## Run

```bash
npm install
npm test
npm start
```

Open `http://localhost:3000`.
