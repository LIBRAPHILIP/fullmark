# Demo

Studionet chain id is 61999. The contract version is `1.0.1-fullmark`. `get_meta.llm_rule` is `none`.

Live desk: https://libraphilip.github.io/fullmark/

Contract: `0x5189fA75697efe0Be604E87034639053705C48F0`

The paid demo is bounty 0. Open `0x78ce5e219075c40410fc45117168f14770dde064d1a0200bee8baee8bddbb9e1`. Claim `0xe3c50ae0fa95f8772e3274e774a60640093f9ab8adca67828dc63308d00ef76e`. The read-back is `deployments/live-check.json`: `PAID`, `record_approved`, escrow 0.

The happy path uses a real Pointercrate record, not a fixture inside the transaction:

- Record `12672`
- URL `https://pointercrate.com/api/v1/records/12672/`
- Demon id `1`
- Player id `575`
- Progress `100`
- Status `approved`
- Date `2018-05-25T12:00:00Z`

Fresh must be off. That completion is from 2018, so a fresh window opened today holds with `record_too_old`.

## In the page

1. Open the app on Studionet.
2. Create an ephemeral account and fund it.
3. If the address field is empty, deploy. If a Fullmark address is already there, leave it.
4. Leave the form on the EnvY preset: demon `1`, player `575`, bar `100`, fresh standing, record preview `12672`, deposit `0.02`, deadline 1 day.
5. Put the ephemeral account on the payee line.
6. Preview. The browser line is a preview. The contract line must say the URL matches.
7. Lock the bounty. Wait until the tape says accepted, then read the new open card from the desk.
8. File record `12672`. Wait until the tape says accepted.
9. The card reloads as `PAID`, basis `record_approved`, escrow `0`, source the slashed Pointercrate URL.

A 2-minute deadline is only for the refund drill. Do not use it for the claim above. Claim has to finish before the deadline, and a Pointercrate round is slower than two minutes.

## From the repo

```
npm install
npm test
npm run test:py
npm run deploy:studionet
npm run demo:studionet
```

`demo:studionet` writes `deployments/live-check.json` only after the stored bounty is `PAID` on record 12672. The deployer key stays in `deploy/deployer.local.json` and is gitignored.

Do not deploy this source with the Studio Next dependency hash. Studionet uses `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.
