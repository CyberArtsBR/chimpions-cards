# CHIMPIONS: Attribute Arena

Competitive Top-Trumps-style battles built around the animated Chimpions collection.

## What is implemented

- CPU matches with random initiative, explicit win/loss/draw endings, production state-machine validation, standoff-pot conservation, and distribution-aware CPU choices.
- **Tactical is the recommended/default competitive ruleset:** initiative alternates every round, the previous attribute cannot be repeated, and each player receives one reserve swap.
- Classic remains available for traditional winner-keeps-initiative play.
- Responsive arena with mobile-first touch targets, visible deck/pot/turn information, battle history, reveal/capture feedback, reduced-motion support, image fallbacks, and preloading.
- Procedural WebAudio music/SFX toggles with no external audio assets.
- Server-authoritative private 1v1 rooms with room validation, turn ownership, 20-second turn timeout, disconnect cleanup, illegal-action rejection, and shared rules with the CPU game.
- Production-engine tests, collection validation, and balance simulation.

## Collection data

`public/data/chimpions.json` now contains the latest official API snapshot: **221 valid animated Chimpions**. The public Chimpions site advertises **222 unique Chimpions**, while the official gallery API currently reports and returns 221. The manifest intentionally records both numbers so this discrepancy cannot be mistaken for a complete 222-card import.

The checked-in balance report is `reports/balance-report.json`.

Current full-snapshot findings:

- Every card uses the same 360-point stat budget.
- Every stat remains within 34–86.
- Attribute means are tightly grouped around 59–61.
- Classic simulation shows a material first-chooser advantage (about 65% in the current benchmark).
- Tactical cuts that initiative advantage substantially; because tied final card counts are treated as honest draws, its benchmark also produces more draws.

For that reason, Tactical is the default competitive experience while Classic is retained as the traditional mode.

Refresh and validate the collection with:

```bash
npm run import
npm run validate:collection
npm run balance
```

A strict completeness check intentionally fails while the official API supplies 221 cards against the advertised 222:

```bash
npm run validate:collection:strict
```

The importer refuses to silently accept an incomplete collection unless `ALLOW_PARTIAL_IMPORT=1` is explicitly set.

## Deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FCyberArtsBR%2Fchimpions-cards)

The repository includes a Render Blueprint (`render.yaml`) for the Node web service and WebSocket multiplayer server. The dedicated health endpoint is `/healthz`.

## Run

```bash
npm install
npm test
npm start
```

Open `http://localhost:3000`.
