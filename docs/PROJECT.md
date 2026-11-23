# Fullmark

Fullmark is a prize escrow for a Geometry Dash demon-list completion. The sponsor locks GEN and names three pins: a Pointercrate demon id, a Pointercrate player id, and a minimum progress. The payee wallet is named at the same time. Later, anyone files a record id. The contract builds the URL and the validators read it.

```
https://pointercrate.com/api/v1/records/<id>/
```

The path needs the trailing slash. Without it, Pointercrate returns 404. The request also sends `Accept: application/json` and a browser User-Agent. A headerless GET from GenVM is Cloudflare's challenge page, and that page does not pay.

## The trust problem

List bounties ("I'll pay you if this record is accepted") are paid from a person's wallet. The argument afterwards is a screenshot of a video, or a screenshot of the list. Pointercrate's moderators already approve or reject the record. Fullmark does not watch the video and does not ask a model whether the clear counts. It pays when Pointercrate's record object says the clear is approved, for those ids, at or above the bar.

A standing prize accepts any approved record. A fresh prize requires the completion timestamp on the record to be on or after the open, so an old clear cannot collect a bounty that was posted for a new one.

## What is not decided here

Player names, demon names, and list positions are labels. Names change. Positions move while a bounty is open. They are not compared.

The contract does not decide who deserves the wallet. The sponsor names the payee. It does not rank the list, and it does not treat a YouTube link typed by the caller as evidence. The video URL stored after payment is the one on the record.

This is not a house game and not a wager on a third-party match. It is escrow for a completion the list has already published.

## Money

The minimum deposit is 0.01 GEN. A successful claim sends the full deposit to the payee. A failed or unreadable read leaves the bounty open and moves nothing. After the deadline, `refund` returns the deposit to the sponsor. Before the deadline, `unwind` returns it only after both the sponsor and the payee have consented. One consent is enough when they are the same account.

## Not the same product as Wavehold

Wavehold holds a tournament purse against a ban counter and does not decide a completion. Fullmark reads an approved progress record and pays that completion.
