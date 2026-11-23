# Fullmark

Fullmark escrows a demon-list prize on GenLayer. The sponsor names a Pointercrate demon id, a player id, a progress bar, and a payee wallet. GEN moves only when validators re-fetch that record and it is approved for those pins.

Primary tag: Gaming. Tag 1: Outcome verification. No LLM.

Studionet contract `0x5189fA75697efe0Be604E87034639053705C48F0`, version `1.0.1-fullmark`. Bounty 0 is paid on record 12672. Source: https://github.com/LIBRAPHILIP/fullmark

Live desk: https://libraphilip.github.io/fullmark/

`npm run dev` serves the same desk locally. The Vercel CLI has no credentials on this machine, so the public copy is GitHub Pages.

The contract builds `https://pointercrate.com/api/v1/records/<id>/`. The caller does not submit the progress, the status, or the URL. Names and list positions are not decision fields.

## Use it

```
npm install
npm run dev
```

The dev server is http://localhost:5188. On Studionet, create an ephemeral account, fund it, deploy or bind the contract, preview record `12672`, lock 0.02 GEN, then file that record. The standing-prize preset matches demon `1`, player `575`, and a 100% bar. Fresh must be off for that 2018 completion.

`HOW_TO_DEMO.md` is the click path. `docs/PROJECT.md` is the product. `docs/CONSENSUS.md` is what the validators compare.

## Checks

```
npm test
npm run test:py
npm run build
```

`npm run deploy:studionet` deploys and writes `src/deployed.json`. `npm run demo:studionet` opens a bounty and claims record 12672, then writes `deployments/live-check.json`.

## Rules, short

- Pay: approved, same player, same demon, progress at or above the bar, player not banned.
- Fresh: the record's completion time is on or after the open. Standing: any approved record.
- Unreadable does not pay and does not refund early. A headerless fetch is Cloudflare's challenge page, so the contract sends `Accept: application/json` and a browser User-Agent.
- Refund: the deadline has passed and the bounty is still open.
- Unwind: sponsor and payee both consent.
