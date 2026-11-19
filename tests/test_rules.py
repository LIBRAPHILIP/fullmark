"""Rule tests for the pure section of contracts/fullmark.py."""

import datetime as dt
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "contracts" / "fullmark.py").read_text(encoding="utf-8")
START = SOURCE.index("# RULES_START\n") + len("# RULES_START\n")
END = SOURCE.index("# RULES_END")
NS = {}
exec(SOURCE[START:END], NS)

extract_record = NS["extract_record"]
judge = NS["judge"]
records_equivalent = NS["records_equivalent"]
record_acceptable = NS["record_acceptable"]
record_url = NS["record_url"]
record_unix = NS["record_unix"]
message_unix = NS["message_unix"]
parse_terms = NS["parse_terms"]
parse_id = NS["parse_id"]
claim_allowed = NS["claim_allowed"]
refund_allowed = NS["refund_allowed"]
flags_after_consent = NS["flags_after_consent"]
unwind_ready = NS["unwind_ready"]
DECISION_FIELDS = NS["DECISION_FIELDS"]
VERSION = NS["VERSION"]

URL = "https://pointercrate.com/api/v1/records/12672/"
BODY = (ROOT / "tests" / "fixtures" / "record-12672.json").read_text(encoding="utf-8")
BODY_FRAC = (ROOT / "tests" / "fixtures" / "record-70084.json").read_text(encoding="utf-8")
PAYEE = "0x" + ("ab" * 20)
SPONSOR = "0x" + ("11" * 20)


def bounty(**overrides):
    base = {
        "player_id": "575",
        "demon_id": "1",
        "min_progress": "100",
        "fresh": "0",
        "opened_at": "1700000000",
        "status": "OPEN",
        "deadline_at": "1700003600",
    }
    base.update(overrides)
    return base


class RulesTest(unittest.TestCase):
    def test_version_and_url(self):
        self.assertEqual(VERSION, "1.0.1-fullmark")
        self.assertEqual(record_url("12672"), URL)
        self.assertTrue(URL.endswith("/"))

    def test_ids_reject_injection(self):
        for raw in ("0", "01", "12672/", "12672?x=1", "https://evil.example/12672", "-1", "1_2", ""):
            with self.assertRaises(ValueError):
                parse_id(raw, "bad_record")
        self.assertEqual(parse_id("12672", "bad_record"), "12672")

    def test_terms(self):
        terms = parse_terms("EnvY record", "standing prize", "1", "575", "100", "0", "86400", PAYEE.upper())
        self.assertEqual(terms["payee"], PAYEE)
        self.assertEqual(terms["fresh"], "0")
        self.assertEqual(terms["min_progress"], "100")
        with self.assertRaises(ValueError):
            parse_terms("E", "", "1", "575", "0", "0", "86400", PAYEE)
        with self.assertRaises(ValueError):
            parse_terms("EnvY", "", "1", "575", "100", "2", "86400", PAYEE)
        with self.assertRaises(ValueError):
            parse_terms("EnvY", "", "1", "575", "100", "0", "60", PAYEE)
        with self.assertRaises(ValueError):
            parse_terms("EnvY", "", "1", "575", "100", "0", "86400", "0x" + ("0" * 40))

    def test_extract_live_shapes(self):
        got = extract_record(BODY, 200, "12672", URL)
        self.assertEqual(got["ok"], "1")
        self.assertEqual(got["status"], "approved")
        self.assertEqual(got["progress"], "100")
        self.assertEqual(got["player_id"], "575")
        self.assertEqual(got["player_banned"], "0")
        self.assertEqual(got["demon_id"], "1")
        self.assertEqual(got["record_date"], "2018-05-25T12:00:00Z")
        self.assertEqual(got["video"], "https://www.youtube.com/watch?v=oo9ZYGJZCwk")
        self.assertNotIn("name", got)
        self.assertNotIn("position", got)

        frac = extract_record(BODY_FRAC, 200, "70084", record_url("70084"))
        self.assertEqual(frac["ok"], "1")
        self.assertEqual(frac["record_date"], "2022-06-15T21:57:07.049712Z")
        self.assertEqual(frac["demon_id"], "47")

    def test_position_and_name_are_not_decision_fields(self):
        parsed = json.loads(BODY)
        moved = json.loads(BODY)
        moved["data"]["demon"]["position"] = 1
        moved["data"]["demon"]["name"] = "Renamed"
        moved["data"]["player"]["name"] = "Other"
        left = extract_record(json.dumps(parsed), 200, "12672", URL)
        right = extract_record(json.dumps(moved), 200, "12672", URL)
        self.assertTrue(records_equivalent(left, right))
        self.assertTrue(record_acceptable(left, "12672", URL))

    def test_extract_failures(self):
        self.assertEqual(extract_record("", 0, "12672", URL)["reason"], "fetch_failed")
        self.assertEqual(extract_record("nope", 404, "12672", URL)["reason"], "http_error")
        self.assertEqual(extract_record("", 200, "12672", URL)["reason"], "empty_body")
        self.assertEqual(extract_record("<html>", 200, "12672", URL)["reason"], "not_json")
        self.assertEqual(extract_record("{}", 200, "12672", URL)["reason"], "missing_data")
        swapped = json.loads(BODY)
        swapped["data"]["id"] = 1
        self.assertEqual(extract_record(json.dumps(swapped), 200, "12672", URL)["reason"], "id_mismatch")
        hidden = '{"message":"missing","code":40401,"data":{"record_id":9}}'
        self.assertEqual(extract_record(hidden, 200, "9", record_url("9"))["reason"], "id_mismatch")
        self.assertEqual(extract_record("x" * 20001, 200, "12672", URL)["reason"], "body_too_large")

    def test_banned_and_status(self):
        banned = json.loads(BODY)
        banned["data"]["player"]["banned"] = True
        got = extract_record(json.dumps(banned), 200, "12672", URL)
        self.assertEqual(got["player_banned"], "1")
        self.assertEqual(judge(bounty(), got)["reason"], "player_banned")

        pending = json.loads(BODY)
        pending["data"]["status"] = "Submitted"
        got = extract_record(json.dumps(pending), 200, "12672", URL)
        self.assertEqual(got["status"], "submitted")
        self.assertEqual(judge(bounty(), got)["reason"], "not_approved")

    def test_judge_pay_and_mismatches(self):
        got = extract_record(BODY, 200, "12672", URL)
        self.assertEqual(judge(bounty(), got), {"outcome": "pay", "reason": "record_approved"})
        self.assertEqual(judge(bounty(min_progress="100"), got)["outcome"], "pay")
        short = bounty(min_progress="100")
        low = json.loads(BODY)
        low["data"]["progress"] = 99
        extracted = extract_record(json.dumps(low), 200, "12672", URL)
        self.assertEqual(judge(short, extracted)["reason"], "progress_short")
        self.assertEqual(judge(bounty(player_id="576"), got)["reason"], "player_mismatch")
        self.assertEqual(judge(bounty(demon_id="2"), got)["reason"], "demon_mismatch")
        self.assertEqual(judge(bounty(), extract_record("", 0, "12672", URL))["reason"], "fetch_failed")

    def test_fresh_window(self):
        got = extract_record(BODY, 200, "12672", URL)
        stamp = record_unix("2018-05-25T12:00:00Z")
        self.assertEqual(
            stamp,
            int(dt.datetime(2018, 5, 25, 12, 0, 0, tzinfo=dt.timezone.utc).timestamp()),
        )
        self.assertEqual(stamp, 1527249600)
        frac = record_unix("2022-06-15T21:57:07.049712Z")
        self.assertEqual(
            frac,
            int(dt.datetime(2022, 6, 15, 21, 57, 7, tzinfo=dt.timezone.utc).timestamp()),
        )
        self.assertEqual(judge(bounty(fresh="1", opened_at=str(stamp)), got)["outcome"], "pay")
        self.assertEqual(judge(bounty(fresh="1", opened_at=str(stamp + 1)), got)["reason"], "record_too_old")
        undated = dict(got)
        undated["record_date"] = ""
        self.assertEqual(judge(bounty(fresh="1"), undated)["reason"], "missing_date")
        self.assertEqual(judge(bounty(fresh="0"), undated)["outcome"], "pay")

    def test_video_difference_breaks_equivalence(self):
        left = extract_record(BODY, 200, "12672", URL)
        right = dict(left)
        right["video"] = "https://example.invalid/other"
        self.assertFalse(records_equivalent(left, right))
        self.assertFalse(record_acceptable(dict(left, source="https://evil.example/"), "12672", URL))

    def test_deadline_and_unwind(self):
        self.assertTrue(claim_allowed("OPEN", "1000", 999))
        self.assertFalse(claim_allowed("OPEN", "1000", 1000))
        self.assertFalse(claim_allowed("PAID", "1000", 1))
        self.assertTrue(refund_allowed("OPEN", "1000", 1000))
        self.assertFalse(refund_allowed("OPEN", "1000", 999))
        flags = flags_after_consent(SPONSOR, SPONSOR, PAYEE, "0", "0")
        self.assertEqual(flags, ("1", "0"))
        self.assertFalse(unwind_ready(*flags))
        both = flags_after_consent(PAYEE, SPONSOR, PAYEE, "1", "0")
        self.assertTrue(unwind_ready(*both))
        same = flags_after_consent(SPONSOR, SPONSOR, SPONSOR, "0", "0")
        self.assertEqual(same, ("1", "1"))

    def test_message_clock(self):
        stamp = int(dt.datetime(2026, 11, 19, 6, 46, 34, tzinfo=dt.timezone.utc).timestamp())
        self.assertEqual(message_unix("2026-11-19T06:46:34Z"), stamp)
        self.assertEqual(message_unix("2026-11-19T08:46:34+02:00"), stamp)
        with self.assertRaises(ValueError):
            message_unix("not-a-time")

    def test_decision_fields_cover_the_extract(self):
        got = extract_record(BODY, 200, "12672", URL)
        for key in DECISION_FIELDS:
            self.assertIn(key, got)


if __name__ == "__main__":
    unittest.main()
