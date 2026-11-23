# Portal submission — Projects (type 41)

Form: https://portal.genlayer.foundation/submit-contribution?type=41

Primary tag: **Gaming**  
Tag 1: **Outcome Verification**

## Title

```
Fullmark
```

## Description / notes

```
Fullmark escrows a demon-list prize until Pointercrate's own record says the clear is approved.

A list bounty is a sentence in a chat. The sponsor holds the money, and the argument is a screenshot. Pointercrate already approves or rejects the record. Fullmark does not watch the video and does not call an LLM.

The sponsor locks GEN and names a demon id, a player id, a minimum progress, and the payee wallet. Anyone later files a record id. Validators re-fetch a URL the contract builds: https://pointercrate.com/api/v1/records/<id>/. The trailing slash is required. The same path without it is a 404. The caller cannot pass the URL, the status, or the progress.

Payment requires status approved, the same player id, the same demon id, progress at or above the bar, and player.banned false. A standing prize accepts any such record. A fresh prize also requires the completion timestamp on the record to be on or after the open. Names and list positions are not decision fields. An unreadable body does not pay and does not refund early. After the deadline the sponsor withdraws. Before that, unwind needs both parties.

No LLM is called. get_meta.llm_rule is none.

The page submits writeContract, shows the tx hash, polls getTransaction / getLastRoundData until ACCEPTED, then reloads the bounty with readContract. A validator that stops after quorum is not treated as a revert. A GenVM traceback is. Preview in the browser is labeled as a preview. The deposit is sent only after preview_open matches the form.

Live record, not a fixture: demon 1, player 575, bar 100, fresh off, record 12672, date 2018-05-25T12:00:00Z, status approved, progress 100. The contract reads https://pointercrate.com/api/v1/records/12672/.
```

## Required evidence

**GitHub repository**

```
https://github.com/LIBRAPHILIP/fullmark
```

## Additional evidence

```
Contract: https://explorer-studio.genlayer.com/address/0x5189fA75697efe0Be604E87034639053705C48F0
Deploy tx: https://explorer-studio.genlayer.com/tx/0x7aafd5336cba6ed87369d21a4e0aad4263bda5dea688c89665a89ac85455b59e
Open tx: https://explorer-studio.genlayer.com/tx/0x78ce5e219075c40410fc45117168f14770dde064d1a0200bee8baee8bddbb9e1
Claim tx: https://explorer-studio.genlayer.com/tx/0xe3c50ae0fa95f8772e3274e774a60640093f9ab8adca67828dc63308d00ef76e
```

Studionet, chain 61999. Contract version `1.0.1-fullmark`. `get_meta.llm_rule` is `none`.

Live read after the claim, stored in `deployments/live-check.json`: bounty 0 is `PAID`, basis `record_approved`, escrow `0`. Source `https://pointercrate.com/api/v1/records/12672/`. Record 12672, demon 1, player 575, progress 100, status approved, date `2018-05-25T12:00:00Z`, fresh off, video `https://www.youtube.com/watch?v=oo9ZYGJZCwk`.

Live app: https://libraphilip.github.io/fullmark/

The page binds `0x5189fA75697efe0Be604E87034639053705C48F0` from `src/deployed.json`. GitHub Pages serves the `gh-pages` branch. The Vercel CLI on this machine has no credentials.
