# Consensus

The only nondeterministic step is `claim`. It calls `gl.nondet.web.get` on the URL `record_url` builds from the record id. `open_bounty`, `refund`, `consent_unwind`, and `unwind` do not fetch.

The GET sends `Accept: application/json` and a browser User-Agent. A headerless GET from GenVM is Cloudflare's challenge page (HTTP 403, HTML titled "Just a moment..."), which is not the record and does not pay. The GenVM response object exposes `status`, not `status_code`. A challenge page, a 404, or any other non-record body still fails closed.

## Decision fields

Validators compare these fields and nothing else:

- `source`
- `record_id`
- `ok`
- `status`
- `progress`
- `player_id`
- `player_banned`
- `demon_id`
- `record_date`
- `video` (truncated to 200 characters)
- `reason`

`judge` then runs in deterministic code on that payload. A pay requires `ok = 1`, `status = approved`, `player_banned = 0`, the pinned player id, the pinned demon id, and `progress` at or above the bar. When `fresh` is `1`, `record_date` must parse and its unix second must be greater than or equal to `opened_at`.

## Ignored on purpose

`player.name`, `demon.name`, `demon.position`, and `demon.rated_position` are not extracted. Two reads that differ only in those fields are equivalent, so a list reshuffle during the round does not fail a claim that is otherwise the same record.

## Fail closed

`fetch_failed`, `http_error`, `empty_body`, `body_too_large`, `not_json`, `id_mismatch`, and the other parse reasons do not pay. The transaction reverts and the bounty stays `OPEN`. A 404, including a record the anonymous API does not show yet, is `http_error`. It is not an early refund.

Bodies over 20,000 characters are rejected. A single record object is a few hundred bytes. A demon page that embeds every record will not be accepted as a record.

## Time

Deadlines and the fresh window use `gl.message_raw["datetime"]`, converted with calendar arithmetic. `time.time()` is not called. The completion timestamp is the `date` field Pointercrate publishes, in the form `YYYY-MM-DDTHH:MM:SSZ` with optional fractional seconds. Fractional seconds are floored. Any other shape is `bad_date` and does not pay.

## Equivalence

The leader's payload is accepted only when a validator's own fetch matches on every decision field and `record_acceptable` holds. A leader that invents a progress, a status, or a video URL does not match the validator's read.
