import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VERSION,
  extractRecord,
  judge,
  recordsEquivalent,
  recordUrl,
  recordUnix,
  messageUnix,
  parseId,
  parseTerms,
  parseGen,
  formatGen,
  MIN_ESCROW_WEI,
} from "../src/genlayer/rules.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const body = readFileSync(path.join(root, "tests", "fixtures", "record-12672.json"), "utf8");
const fracBody = readFileSync(path.join(root, "tests", "fixtures", "record-70084.json"), "utf8");
const url = "https://pointercrate.com/api/v1/records/12672/";

function sampleBounty(overrides = {}) {
  return {
    player_id: "575",
    demon_id: "1",
    min_progress: "100",
    fresh: "0",
    opened_at: "1700000000",
    ...overrides,
  };
}

test("version and slashed record url", () => {
  assert.equal(VERSION, "1.0.1-fullmark");
  assert.equal(recordUrl("12672"), url);
  assert.throws(() => parseId("12672/", "bad_record"));
  assert.throws(() => parseId("0", "bad_record"));
});

test("extracts the published record and ignores position", () => {
  const got = extractRecord(body, 200, "12672", url);
  assert.equal(got.ok, "1");
  assert.equal(got.player_id, "575");
  assert.equal(got.demon_id, "1");
  assert.equal(got.progress, "100");
  assert.equal(got.status, "approved");
  assert.equal(got.record_date, "2018-05-25T12:00:00Z");
  assert.equal(judge(sampleBounty(), got).outcome, "pay");

  const moved = JSON.parse(body);
  moved.data.demon.position = 3;
  moved.data.player.name = "Renamed";
  const other = extractRecord(JSON.stringify(moved), 200, "12672", url);
  assert.equal(recordsEquivalent(got, other), true);

  const fractional = extractRecord(fracBody, 200, "70084", recordUrl("70084"));
  assert.equal(fractional.record_date, "2022-06-15T21:57:07.049712Z");
  assert.equal(recordUnix(fractional.record_date), 1655330227);
  assert.equal(recordUnix(got.record_date), 1527249600);
});

test("fresh window and mismatches hold the purse", () => {
  const got = extractRecord(body, 200, "12672", url);
  assert.equal(judge(sampleBounty({ fresh: "1", opened_at: "1527249600" }), got).outcome, "pay");
  assert.equal(judge(sampleBounty({ fresh: "1", opened_at: "1527249601" }), got).reason, "record_too_old");
  assert.equal(judge(sampleBounty({ player_id: "1" }), got).reason, "player_mismatch");
  assert.equal(judge(sampleBounty({ demon_id: "2" }), got).reason, "demon_mismatch");
  const low = JSON.parse(body);
  low.data.progress = 99;
  assert.equal(judge(sampleBounty(), extractRecord(JSON.stringify(low), 200, "12672", url)).reason, "progress_short");
  const banned = JSON.parse(body);
  banned.data.player.banned = true;
  assert.equal(judge(sampleBounty(), extractRecord(JSON.stringify(banned), 200, "12672", url)).reason, "player_banned");
  assert.equal(extractRecord("<html>just a moment</html>", 200, "12672", url).reason, "not_json");
  assert.equal(extractRecord("", 404, "12672", url).reason, "http_error");
});

test("terms, clock, and GEN units", () => {
  const payee = `0x${"ab".repeat(20)}`;
  const terms = parseTerms({
    label: "EnvY record",
    note: "standing prize",
    demonId: "1",
    playerId: "575",
    minProgress: "100",
    fresh: "0",
    deadlineSecs: "86400",
    payee: payee.toUpperCase(),
  });
  assert.equal(terms.payee, payee);
  assert.equal(messageUnix("2026-11-19T08:46:34+02:00"), messageUnix("2026-11-19T06:46:34Z"));
  assert.equal(parseGen("0.02"), 2n * 10n ** 16n);
  assert.equal(formatGen(MIN_ESCROW_WEI), "0.01");
  assert.throws(() => parseGen("0.02 GEN"));
});
