# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Fullmark — a prize escrow for a Pointercrate record.

A demon-list bounty is usually a sentence in a chat. The sponsor is the
custodian, and the evidence is a screenshot of a video. Pointercrate already
has moderators who approve or reject the record. Fullmark does not watch the
video and does not ask an LLM whether the clear counts.

The sponsor locks GEN and names three pins: a demon id, a player id, and a
minimum progress. The payee is a wallet named up front. Anyone may later file
a record id. Validators re-fetch a URL this contract builds:

  https://pointercrate.com/api/v1/records/<id>/

The trailing slash is required. The same path without it is a 404.

Payment happens only when that object is approved, the player and demon ids
match the pins, the player is not banned, and progress is at or above the
bar. A fresh bounty also requires the record's completion timestamp to be on
or after the open. Names and list positions are not decision fields: names
change, and positions move while a bounty is open.

An unreadable response, a hidden record, or a short progress does not pay
and does not refund. After the deadline the sponsor can take the deposit
back. Before that, refund needs the sponsor and the payee both to consent.
"""

from genlayer import *

import json
import typing


# RULES_START
import json
import re

VERSION = "1.0.1-fullmark"
HOST = "pointercrate.com"
MIN_ESCROW_WEI = 10**16
MIN_DEADLINE_SECS = 120
MAX_DEADLINE_SECS = 180 * 24 * 3600
MIN_PROGRESS = 1
MAX_PROGRESS = 100
BODY_CAP = 20000
VIDEO_CAP = 200
PAY_REASON = "record_approved"
LLM_RULE = "none"
SOURCE_RULE = "contract_built_https_only"
PAY_RULE = "approved_record_matches_pin"
REFUND_RULE = "deadline_while_open"
UNWIND_RULE = "sponsor_and_payee_consent"
FAIL_RULE = "unreadable_does_not_pay"
FRESH_RULE = "completion_on_or_after_open"

DECISION_FIELDS = (
    "source",
    "record_id",
    "ok",
    "status",
    "progress",
    "player_id",
    "player_banned",
    "demon_id",
    "record_date",
    "video",
    "reason",
)

FAIL_REASONS = (
    "fetch_failed",
    "http_error",
    "empty_body",
    "body_too_large",
    "not_json",
    "missing_data",
    "id_mismatch",
    "bad_status",
    "bad_progress",
    "missing_player",
    "bad_banned",
    "missing_demon",
    "bad_date",
)

_ID = re.compile(r"^[1-9][0-9]{0,8}$")
_BOUNTY = re.compile(r"^(?:0|[1-9][0-9]{0,8})$")
_PROGRESS = re.compile(r"^(?:100|[1-9][0-9]?)$")
_DEADLINE = re.compile(r"^[1-9][0-9]{0,8}$")
_ADDRESS = re.compile(r"^0x[0-9a-f]{40}$")
_STATUS = re.compile(r"^[a-z0-9 ]{1,40}$")
_RECORD_DATE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$"
)
_TX_TIME = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2}|[+-]\d{4})?$"
)


def record_url(record_id: str) -> str:
    # Pointercrate answers the slashed path with the record JSON.
    # The same path without the slash is HTTP 404.
    return "https://pointercrate.com/api/v1/records/" + str(record_id) + "/"


def _leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def civil_to_unix(year: int, month: int, day: int) -> int:
    # Howard Hinnant, days_from_civil. Public-domain calendar math.
    year_adj = year - 1 if month <= 2 else year
    era = year_adj // 400 if year_adj >= 0 else (year_adj - 399) // 400
    yoe = year_adj - era * 400
    month_adj = month - 3 if month > 2 else month + 9
    doy = (153 * month_adj + 2) // 5 + day - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    days = era * 146097 + doe - 719468
    return days * 86400


def message_unix(raw: str) -> int:
    """Unix seconds from the transaction datetime. No host clock."""
    match = _TX_TIME.fullmatch(str(raw or "").strip())
    if not match:
        raise ValueError("bad_tx_time")
    year = int(match.group(1))
    month = int(match.group(2))
    day = int(match.group(3))
    hour = int(match.group(4))
    minute = int(match.group(5))
    second = int(match.group(6))
    if year < 1970 or month < 1 or month > 12 or day < 1:
        raise ValueError("bad_tx_time")
    lengths = [0, 31, 29 if _leap(year) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if day > lengths[month] or hour > 23 or minute > 59 or second > 59:
        raise ValueError("bad_tx_time")
    stamp = civil_to_unix(year, month, day) + hour * 3600 + minute * 60 + second
    zone = match.group(7) or "Z"
    if zone != "Z":
        sign = 1 if zone[0] == "+" else -1
        digits = zone[1:].replace(":", "")
        off_hour = int(digits[0:2])
        off_minute = int(digits[2:4])
        if off_hour > 23 or off_minute > 59:
            raise ValueError("bad_tx_time")
        stamp -= sign * (off_hour * 3600 + off_minute * 60)
    if stamp <= 0:
        raise ValueError("bad_tx_time")
    return stamp


def record_unix(raw: str) -> int:
    match = _RECORD_DATE.fullmatch(str(raw or "").strip())
    if not match:
        raise ValueError("bad_date")
    year = int(match.group(1))
    month = int(match.group(2))
    day = int(match.group(3))
    hour = int(match.group(4))
    minute = int(match.group(5))
    second = int(match.group(6))
    if year < 2000 or year > 2100 or month < 1 or month > 12 or day < 1:
        raise ValueError("bad_date")
    lengths = [0, 31, 29 if _leap(year) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if day > lengths[month] or hour > 23 or minute > 59 or second > 59:
        raise ValueError("bad_date")
    return civil_to_unix(year, month, day) + hour * 3600 + minute * 60 + second


def parse_id(raw: str, code: str) -> str:
    text = (raw or "").strip()
    if not _ID.match(text):
        raise ValueError(code)
    return text


def parse_bounty_id(raw: str) -> str:
    text = (raw or "").strip()
    if not _BOUNTY.match(text):
        raise ValueError("bad_bounty")
    return str(int(text))


def parse_progress(raw: str) -> int:
    text = (raw or "").strip()
    if not _PROGRESS.match(text):
        raise ValueError("bad_progress")
    value = int(text)
    if value < MIN_PROGRESS or value > MAX_PROGRESS:
        raise ValueError("bad_progress")
    return value


def parse_fresh(raw: str) -> str:
    text = (raw or "").strip()
    if text not in ("0", "1"):
        raise ValueError("bad_fresh")
    return text


def parse_deadline(raw: str) -> int:
    text = (raw or "").strip()
    if not _DEADLINE.match(text):
        raise ValueError("bad_deadline")
    secs = int(text)
    if secs < MIN_DEADLINE_SECS:
        raise ValueError("deadline_too_short")
    if secs > MAX_DEADLINE_SECS:
        raise ValueError("deadline_too_long")
    return secs


def normalize_address(raw: str) -> str:
    text = (raw or "").strip()
    if len(text) < 2 or text[:2].lower() != "0x":
        raise ValueError("bad_address")
    lowered = "0x" + text[2:].lower()
    if not _ADDRESS.match(lowered):
        raise ValueError("bad_address")
    if lowered == "0x" + ("0" * 40):
        raise ValueError("bad_address")
    return lowered


def clip_text(raw: str, limit: int, code: str, required: bool) -> str:
    text = "".join(ch for ch in (raw or "") if ch >= " " and ch != "\x7f")
    text = " ".join(text.split())
    if required and len(text) < 2:
        raise ValueError(code)
    if len(text) > limit:
        raise ValueError(code)
    return text


def parse_terms(
    label: str,
    note: str,
    demon_id: str,
    player_id: str,
    min_progress: str,
    fresh: str,
    deadline_secs: str,
    payee: str,
) -> dict:
    return {
        "label": clip_text(label, 48, "bad_label", True),
        "note": clip_text(note, 160, "bad_note", False),
        "demon_id": parse_id(demon_id, "bad_demon"),
        "player_id": parse_id(player_id, "bad_player"),
        "min_progress": str(parse_progress(min_progress)),
        "fresh": parse_fresh(fresh),
        "deadline_secs": str(parse_deadline(deadline_secs)),
        "payee": normalize_address(payee),
    }


def _blank_record(record_id: str, url: str, reason: str) -> dict:
    return {
        "source": url,
        "record_id": str(record_id),
        "ok": "0",
        "status": "",
        "progress": "-1",
        "player_id": "",
        "player_banned": "",
        "demon_id": "",
        "record_date": "",
        "video": "",
        "reason": reason,
    }


def _clean_video(raw) -> str:
    if not isinstance(raw, str):
        return ""
    text = "".join(ch for ch in raw if ch >= " " and ch != "\x7f")
    if len(text) > VIDEO_CAP:
        text = text[:VIDEO_CAP]
    return text


def extract_record(body: str, status: int, record_id: str, url: str) -> dict:
    base = _blank_record(record_id, url, "fetch_failed")
    code = int(status)
    if code <= 0:
        return base
    if code >= 400:
        base["reason"] = "http_error"
        return base
    text = body or ""
    if not str(text).strip():
        base["reason"] = "empty_body"
        return base
    if len(text) > BODY_CAP:
        base["reason"] = "body_too_large"
        return base
    try:
        parsed = json.loads(text)
    except Exception:
        base["reason"] = "not_json"
        return base
    if not isinstance(parsed, dict):
        base["reason"] = "not_json"
        return base
    data = parsed.get("data")
    if not isinstance(data, dict):
        base["reason"] = "missing_data"
        return base
    found = data.get("id")
    if isinstance(found, bool) or not isinstance(found, int) or str(found) != str(record_id):
        base["reason"] = "id_mismatch"
        return base
    status_text = data.get("status")
    if not isinstance(status_text, str):
        base["reason"] = "bad_status"
        return base
    status_text = " ".join(status_text.strip().lower().split())
    if not _STATUS.match(status_text):
        base["reason"] = "bad_status"
        return base
    progress = data.get("progress")
    if isinstance(progress, bool) or not isinstance(progress, int) or progress < 0 or progress > 100:
        base["reason"] = "bad_progress"
        return base
    player = data.get("player")
    if not isinstance(player, dict):
        base["reason"] = "missing_player"
        return base
    player_id = player.get("id")
    if isinstance(player_id, bool) or not isinstance(player_id, int) or player_id <= 0 or player_id > 999999999:
        base["reason"] = "missing_player"
        return base
    banned = player.get("banned")
    if not isinstance(banned, bool):
        base["reason"] = "bad_banned"
        return base
    demon = data.get("demon")
    if not isinstance(demon, dict):
        base["reason"] = "missing_demon"
        return base
    demon_id = demon.get("id")
    if isinstance(demon_id, bool) or not isinstance(demon_id, int) or demon_id <= 0 or demon_id > 999999999:
        base["reason"] = "missing_demon"
        return base
    date = data.get("date")
    if date is None:
        date = ""
    if not isinstance(date, str):
        base["reason"] = "bad_date"
        return base
    date = date.strip()
    if date:
        try:
            record_unix(date)
        except ValueError:
            base["reason"] = "bad_date"
            return base
    base["ok"] = "1"
    base["status"] = status_text
    base["progress"] = str(progress)
    base["player_id"] = str(player_id)
    base["player_banned"] = "1" if banned else "0"
    base["demon_id"] = str(demon_id)
    base["record_date"] = date
    base["video"] = _clean_video(data.get("video"))
    base["reason"] = "ok"
    return base


def judge(bounty: dict, extracted: dict) -> dict:
    if not isinstance(extracted, dict) or extracted.get("ok") != "1":
        reason = "fetch_failed"
        if isinstance(extracted, dict) and extracted.get("reason"):
            reason = str(extracted.get("reason"))
        return {"outcome": "hold", "reason": reason}
    if extracted.get("source") != record_url(str(extracted.get("record_id"))):
        return {"outcome": "hold", "reason": "bad_source"}
    if str(extracted.get("player_banned")) == "1":
        return {"outcome": "hold", "reason": "player_banned"}
    if str(extracted.get("player_id")) != str(bounty.get("player_id")):
        return {"outcome": "hold", "reason": "player_mismatch"}
    if str(extracted.get("demon_id")) != str(bounty.get("demon_id")):
        return {"outcome": "hold", "reason": "demon_mismatch"}
    if str(extracted.get("status")) != "approved":
        return {"outcome": "hold", "reason": "not_approved"}
    if int(extracted.get("progress")) < int(bounty.get("min_progress")):
        return {"outcome": "hold", "reason": "progress_short"}
    if str(bounty.get("fresh")) == "1":
        if not extracted.get("record_date"):
            return {"outcome": "hold", "reason": "missing_date"}
        try:
            stamp = record_unix(str(extracted.get("record_date")))
        except ValueError:
            return {"outcome": "hold", "reason": "bad_date"}
        if stamp < int(bounty.get("opened_at")):
            return {"outcome": "hold", "reason": "record_too_old"}
    return {"outcome": "pay", "reason": PAY_REASON}


def records_equivalent(left: dict, right: dict) -> bool:
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    for key in DECISION_FIELDS:
        if str(left.get(key, "")) != str(right.get(key, "")):
            return False
    return True


def record_acceptable(payload: dict, record_id: str, url: str) -> bool:
    if not isinstance(payload, dict):
        return False
    if payload.get("source") != url or payload.get("record_id") != str(record_id):
        return False
    if payload.get("ok") == "0":
        return payload.get("reason") in FAIL_REASONS
    if payload.get("ok") != "1" or payload.get("reason") != "ok":
        return False
    if payload.get("player_banned") not in ("0", "1"):
        return False
    if not _STATUS.match(str(payload.get("status") or "")):
        return False
    if not _ID.match(str(payload.get("player_id") or "")):
        return False
    if not _ID.match(str(payload.get("demon_id") or "")):
        return False
    progress = str(payload.get("progress") or "")
    if not re.fullmatch(r"(?:0|[1-9][0-9]?|100)", progress):
        return False
    date = str(payload.get("record_date") or "")
    if date:
        try:
            record_unix(date)
        except ValueError:
            return False
    video = payload.get("video")
    if not isinstance(video, str) or len(video) > VIDEO_CAP:
        return False
    return True


def claim_allowed(status: str, deadline_at: str, now: int) -> bool:
    return status == "OPEN" and int(now) < int(deadline_at)


def refund_allowed(status: str, deadline_at: str, now: int) -> bool:
    return status == "OPEN" and int(now) >= int(deadline_at)


def flags_after_consent(sender: str, sponsor: str, payee: str, sponsor_flag: str, payee_flag: str) -> tuple:
    sponsor_next = sponsor_flag
    payee_next = payee_flag
    if sender == sponsor:
        sponsor_next = "1"
    if sender == payee:
        payee_next = "1"
    return sponsor_next, payee_next


def unwind_ready(sponsor_flag: str, payee_flag: str) -> bool:
    return sponsor_flag == "1" and payee_flag == "1"


# RULES_END


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


class Fullmark(gl.Contract):
    bounty_count: u256
    bounties: TreeMap[str, str]
    version: str
    title: str

    def __init__(self):
        self.bounty_count = u256(0)
        self.version = VERSION
        self.title = "Fullmark"

    @gl.public.view
    def get_meta(self) -> dict[str, str]:
        return {
            "title": self.title,
            "version": self.version,
            "bounty_count": str(self.bounty_count),
            "primitive": "sealed-list-record",
            "category": "gaming",
            "tag": "outcome-verification",
            "llm_rule": LLM_RULE,
            "source_rule": SOURCE_RULE,
            "host": HOST,
            "pay_rule": PAY_RULE,
            "refund_rule": REFUND_RULE,
            "unwind_rule": UNWIND_RULE,
            "fail_rule": FAIL_RULE,
            "fresh_rule": FRESH_RULE,
            "min_escrow_wei": str(MIN_ESCROW_WEI),
            "min_deadline_secs": str(MIN_DEADLINE_SECS),
            "max_deadline_secs": str(MAX_DEADLINE_SECS),
        }

    @gl.public.view
    def describe(self) -> dict[str, str]:
        return {
            "name": "Fullmark",
            "problem": "A list bounty pays from a person's wallet, and the proof is a screenshot. Fullmark keeps the GEN here and reads the record itself.",
            "source": "https://pointercrate.com/api/v1/records/<id>/",
            "pays_on": "approved, same player, same demon, progress at or above the pin, player not banned",
            "fresh": "when set, the completion timestamp must be on or after the open",
            "refunds_on": "deadline passed while the bounty is still open, to the sponsor",
            "unreadable": "does not pay and does not refund before the deadline",
            "ignored": "player name, demon name, list position, video opinion",
            "llm": "not used",
            "not_accepted": "a URL chosen by the sponsor, or a progress typed by the caller",
        }

    @gl.public.view
    def get_bounty_count(self) -> u256:
        return self.bounty_count

    @gl.public.view
    def get_bounty(self, bounty_id: str) -> str:
        rec = self._read(bounty_id)
        if rec is None:
            return json.dumps({"error": "bounty_not_found", "bounty_id": str(bounty_id)})
        return json.dumps(rec, sort_keys=True)

    @gl.public.view
    def list_bounties(self, offset: u256, limit: u256) -> typing.Any:
        off = max(0, int(offset))
        lim = int(limit)
        if lim <= 0:
            lim = 10
        if lim > 20:
            lim = 20
        total = int(self.bounty_count)
        out = []
        idx = total - 1 - off
        while idx >= 0 and len(out) < lim:
            key = str(idx)
            if key in self.bounties:
                out.append(self.bounties[key])
            idx -= 1
        return out

    @gl.public.view
    def preview_open(
        self,
        label: str,
        note: str,
        demon_id: str,
        player_id: str,
        min_progress: str,
        fresh: str,
        deadline_secs: str,
        payee: str,
    ) -> str:
        try:
            terms = parse_terms(label, note, demon_id, player_id, min_progress, fresh, deadline_secs, payee)
        except ValueError as exc:
            return json.dumps({"error": str(exc)})
        terms["host"] = HOST
        return json.dumps(terms, sort_keys=True)

    @gl.public.view
    def preview_record(self, record_id: str) -> str:
        try:
            rid = parse_id(record_id, "bad_record")
        except ValueError as exc:
            return json.dumps({"error": str(exc)})
        return json.dumps({"record_id": rid, "source": record_url(rid)}, sort_keys=True)

    @gl.public.write.payable
    def open_bounty(
        self,
        label: str,
        note: str,
        demon_id: str,
        player_id: str,
        min_progress: str,
        fresh: str,
        deadline_secs: str,
        payee: str,
    ) -> str:
        try:
            terms = parse_terms(label, note, demon_id, player_id, min_progress, fresh, deadline_secs, payee)
        except ValueError as exc:
            raise Exception(str(exc))
        escrow = int(gl.message.value)
        if escrow < MIN_ESCROW_WEI:
            raise Exception("escrow_too_small")
        now = _now_ts()
        bounty_id = str(int(self.bounty_count))
        secs = int(terms["deadline_secs"])
        rec = {
            "bounty_id": bounty_id,
            "status": "OPEN",
            "label": terms["label"],
            "note": terms["note"],
            "sponsor": self._sender(),
            "payee": terms["payee"],
            "demon_id": terms["demon_id"],
            "player_id": terms["player_id"],
            "min_progress": terms["min_progress"],
            "fresh": terms["fresh"],
            "escrow_wei": str(escrow),
            "opened_at": str(now),
            "deadline_at": str(now + secs),
            "deadline_secs": terms["deadline_secs"],
            "sponsor_unwind": "0",
            "payee_unwind": "0",
            "settlement_basis": "",
            "last_reason": "opened",
            "record_id": "",
            "record_status": "",
            "progress": "",
            "record_date": "",
            "video": "",
            "source": "",
            "claimed_at": "",
        }
        self._write(rec)
        self.bounty_count = u256(int(self.bounty_count) + 1)
        return json.dumps(
            {"bounty_id": bounty_id, "status": "OPEN", "escrow_wei": str(escrow)},
            sort_keys=True,
        )

    @gl.public.write
    def claim(self, bounty_id: str, record_id: str) -> str:
        self._reject_value()
        rec = self._require(bounty_id)
        now = _now_ts()
        if not claim_allowed(rec["status"], rec["deadline_at"], now):
            if rec["status"] != "OPEN":
                raise Exception("not_open")
            raise Exception("deadline_passed")
        try:
            rid = parse_id(record_id, "bad_record")
        except ValueError as exc:
            raise Exception(str(exc))
        url = record_url(rid)
        payload = self._consensus_record(rid, url)
        verdict = judge(rec, payload)
        if verdict["outcome"] != "pay":
            raise Exception(str(verdict["reason"]))
        rec["record_id"] = payload["record_id"]
        rec["record_status"] = payload["status"]
        rec["progress"] = payload["progress"]
        rec["record_date"] = payload["record_date"]
        rec["video"] = payload["video"]
        rec["source"] = payload["source"]
        rec["claimed_at"] = str(now)
        self._finish(rec, "PAID", PAY_REASON, rec["payee"])
        return "PAID"

    @gl.public.write
    def refund(self, bounty_id: str) -> str:
        self._reject_value()
        rec = self._require(bounty_id)
        now = _now_ts()
        if not refund_allowed(rec["status"], rec["deadline_at"], now):
            if rec["status"] != "OPEN":
                raise Exception("not_open")
            raise Exception("deadline_open")
        self._finish(rec, "REFUNDED", "deadline_passed", rec["sponsor"])
        return "REFUNDED"

    @gl.public.write
    def consent_unwind(self, bounty_id: str) -> str:
        self._reject_value()
        rec = self._require(bounty_id)
        if rec["status"] != "OPEN":
            raise Exception("not_open")
        sender = self._sender()
        if sender != rec["sponsor"] and sender != rec["payee"]:
            raise Exception("not_party")
        sponsor_flag, payee_flag = flags_after_consent(
            sender,
            rec["sponsor"],
            rec["payee"],
            rec["sponsor_unwind"],
            rec["payee_unwind"],
        )
        rec["sponsor_unwind"] = sponsor_flag
        rec["payee_unwind"] = payee_flag
        rec["last_reason"] = "consent"
        self._write(rec)
        return json.dumps(
            {
                "bounty_id": rec["bounty_id"],
                "sponsor_unwind": rec["sponsor_unwind"],
                "payee_unwind": rec["payee_unwind"],
            },
            sort_keys=True,
        )

    @gl.public.write
    def unwind(self, bounty_id: str) -> str:
        self._reject_value()
        rec = self._require(bounty_id)
        if rec["status"] != "OPEN":
            raise Exception("not_open")
        if not unwind_ready(rec["sponsor_unwind"], rec["payee_unwind"]):
            raise Exception("consent_incomplete")
        self._finish(rec, "UNWOUND", "mutual_unwind", rec["sponsor"])
        return "UNWOUND"

    def _consensus_record(self, record_id: str, url: str) -> dict:
        rid = record_id
        source = url

        def leader_fn():
            return _fetch_record(rid)

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            proposed = leader_result.calldata
            if not record_acceptable(proposed, rid, source):
                return False
            try:
                mine = leader_fn()
            except Exception:
                return False
            return records_equivalent(proposed, mine)

        payload = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        if not record_acceptable(payload, rid, source):
            raise Exception("invalid_consensus_payload")
        return payload

    def _finish(self, rec: dict, status: str, basis: str, payee: str) -> None:
        amount = int(rec["escrow_wei"])
        rec["escrow_wei"] = "0"
        rec["status"] = status
        rec["settlement_basis"] = basis
        rec["last_reason"] = basis
        self._write(rec)
        self._pay(payee, amount)

    def _read(self, bounty_id: str):
        try:
            key = parse_bounty_id(bounty_id)
        except ValueError:
            return None
        if key not in self.bounties:
            return None
        try:
            rec = json.loads(self.bounties[key])
        except Exception:
            return None
        if not isinstance(rec, dict):
            return None
        return rec

    def _require(self, bounty_id: str) -> dict:
        rec = self._read(bounty_id)
        if rec is None:
            raise Exception("bounty_not_found")
        return rec

    def _write(self, rec: dict) -> None:
        self.bounties[str(rec["bounty_id"])] = json.dumps(rec, sort_keys=True)

    def _sender(self) -> str:
        return gl.message.sender_address.as_hex.lower()

    def _reject_value(self) -> None:
        if int(gl.message.value) != 0:
            raise Exception("unexpected_value")

    def _pay(self, to_hex: str, amount: int) -> None:
        if int(amount) <= 0 or not to_hex:
            return
        _Recipient(Address(to_hex)).emit_transfer(value=u256(int(amount)))


def _now_ts() -> int:
    # gl.message_raw["datetime"] is the transaction timestamp. Every validator
    # re-executing this message sees the same string. time.time() is the host
    # clock and is not used on the deadline, the fresh window, or settlement.
    try:
        raw = gl.message_raw["datetime"]
    except Exception:
        raise Exception("bad_tx_time")
    try:
        return message_unix(raw)
    except ValueError as exc:
        raise Exception(str(exc))


def _fetch_record(record_id: str) -> dict:
    url = record_url(record_id)
    status, body = _http_get(url)
    return extract_record(body, status, record_id, url)


# A headerless GET from GenVM is Cloudflare's challenge page, not the record.
# These two headers are what Studionet needed to receive the JSON object.
_FETCH_HEADERS = {
    "Accept": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
}


def _coerce_status(raw, default: int) -> int:
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _http_get(url: str) -> tuple:
    try:
        res = gl.nondet.web.get(url, headers=_FETCH_HEADERS)
    except Exception:
        return 0, ""
    if isinstance(res, str):
        return 200, res
    if isinstance(res, (bytes, bytearray)):
        return 200, res.decode("utf-8", errors="replace")
    if isinstance(res, dict):
        if "data" in res and "status" not in res and "status_code" not in res and "body" not in res:
            return 200, json.dumps(res, separators=(",", ":"), ensure_ascii=False)
        status = _coerce_status(res.get("status_code"), 0)
        if status <= 0:
            status = _coerce_status(res.get("status"), 200)
        raw = res.get("body", "")
    else:
        # The GenVM Response exposes status, not status_code.
        status = _coerce_status(getattr(res, "status_code", None), 0)
        if status <= 0:
            status = _coerce_status(getattr(res, "status", None), 200)
        raw = getattr(res, "body", b"")
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    elif not isinstance(raw, str):
        decode = getattr(raw, "decode", None)
        if callable(decode):
            try:
                raw = decode("utf-8")
            except Exception:
                raw = ""
        else:
            raw = ""
    text = str(raw or "")
    if status >= 400 and not text.lstrip().startswith("{"):
        return status, ""
    return status, text
