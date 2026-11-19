/**
 * Browser mirror of the pure rules in contracts/fullmark.py.
 * Opening a bounty still asks the contract to preview the terms and refuses
 * to send the deposit if the two parses disagree. The claim fetches on chain.
 */

export const VERSION = "1.0.1-fullmark";
export const HOST = "pointercrate.com";
export const MIN_ESCROW_WEI = 10n ** 16n;
export const MIN_DEADLINE_SECS = 120;
export const MAX_DEADLINE_SECS = 180 * 24 * 3600;
export const PAY_REASON = "record_approved";

export const DECISION_FIELDS = [
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
];

const ID = /^[1-9][0-9]{0,8}$/;
const PROGRESS = /^(?:100|[1-9][0-9]?)$/;
const DEADLINE = /^[1-9][0-9]{0,8}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const STATUS = /^[a-z0-9 ]{1,40}$/;
const RECORD_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;
const TX_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2}|[+-]\d{4})?$/;
const BODY_CAP = 20000;
const VIDEO_CAP = 200;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function recordUrl(recordId) {
  return `https://pointercrate.com/api/v1/records/${recordId}/`;
}

function leap(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function civilToUnix(year, month, day) {
  const yearAdj = month <= 2 ? year - 1 : year;
  const era = yearAdj >= 0 ? Math.floor(yearAdj / 400) : Math.floor((yearAdj - 399) / 400);
  const yoe = yearAdj - era * 400;
  const monthAdj = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * monthAdj + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const days = era * 146097 + doe - 719468;
  return days * 86400;
}

export function recordUnix(raw) {
  const match = RECORD_DATE.exec(String(raw || "").trim());
  if (!match) throw fail("bad_date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) throw fail("bad_date");
  const lengths = [0, 31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > lengths[month] || hour > 23 || minute > 59 || second > 59) throw fail("bad_date");
  return civilToUnix(year, month, day) + hour * 3600 + minute * 60 + second;
}

export function messageUnix(raw) {
  const match = TX_TIME.exec(String(raw || "").trim());
  if (!match) throw fail("bad_tx_time");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1970 || month < 1 || month > 12 || day < 1) throw fail("bad_tx_time");
  const lengths = [0, 31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > lengths[month] || hour > 23 || minute > 59 || second > 59) throw fail("bad_tx_time");
  let stamp = civilToUnix(year, month, day) + hour * 3600 + minute * 60 + second;
  const zone = match[7] || "Z";
  if (zone !== "Z") {
    const sign = zone[0] === "+" ? 1 : -1;
    const digits = zone.slice(1).replace(":", "");
    const offHour = Number(digits.slice(0, 2));
    const offMinute = Number(digits.slice(2, 4));
    if (offHour > 23 || offMinute > 59) throw fail("bad_tx_time");
    stamp -= sign * (offHour * 3600 + offMinute * 60);
  }
  if (stamp <= 0) throw fail("bad_tx_time");
  return stamp;
}

export function parseId(raw, code) {
  const text = String(raw || "").trim();
  if (!ID.test(text)) throw fail(code);
  return text;
}

export function parseProgress(raw) {
  const text = String(raw || "").trim();
  if (!PROGRESS.test(text)) throw fail("bad_progress");
  const value = Number(text);
  if (value < 1 || value > 100) throw fail("bad_progress");
  return value;
}

export function parseFresh(raw) {
  const text = String(raw || "").trim();
  if (text !== "0" && text !== "1") throw fail("bad_fresh");
  return text;
}

export function parseDeadline(raw) {
  const text = String(raw || "").trim();
  if (!DEADLINE.test(text)) throw fail("bad_deadline");
  const secs = Number(text);
  if (secs < MIN_DEADLINE_SECS) throw fail("deadline_too_short");
  if (secs > MAX_DEADLINE_SECS) throw fail("deadline_too_long");
  return secs;
}

export function normalizeAddress(raw) {
  const text = String(raw || "").trim();
  if (text.length < 2 || text.slice(0, 2).toLowerCase() !== "0x") throw fail("bad_address");
  const lowered = `0x${text.slice(2).toLowerCase()}`;
  if (!ADDRESS.test(lowered)) throw fail("bad_address");
  if (lowered === `0x${"0".repeat(40)}`) throw fail("bad_address");
  return lowered;
}

export function clipText(raw, limit, code, required) {
  const kept = String(raw || "")
    .split("")
    .filter((ch) => ch >= " " && ch !== "\u007f")
    .join("");
  const text = kept.split(/\s+/).filter(Boolean).join(" ");
  if (required && text.length < 2) throw fail(code);
  if (text.length > limit) throw fail(code);
  return text;
}

export function parseTerms({ label, note, demonId, playerId, minProgress, fresh, deadlineSecs, payee }) {
  return {
    label: clipText(label, 48, "bad_label", true),
    note: clipText(note || "", 160, "bad_note", false),
    demon_id: parseId(demonId, "bad_demon"),
    player_id: parseId(playerId, "bad_player"),
    min_progress: String(parseProgress(minProgress)),
    fresh: parseFresh(fresh),
    deadline_secs: String(parseDeadline(deadlineSecs)),
    payee: normalizeAddress(payee),
  };
}

function blankRecord(recordId, url, reason) {
  return {
    source: url,
    record_id: String(recordId),
    ok: "0",
    status: "",
    progress: "-1",
    player_id: "",
    player_banned: "",
    demon_id: "",
    record_date: "",
    video: "",
    reason,
  };
}

function cleanVideo(raw) {
  if (typeof raw !== "string") return "";
  const text = raw
    .split("")
    .filter((ch) => ch >= " " && ch !== "\u007f")
    .join("");
  return text.length > VIDEO_CAP ? text.slice(0, VIDEO_CAP) : text;
}

function isInt(value) {
  return typeof value === "number" && Number.isInteger(value);
}

export function extractRecord(body, status, recordId, url) {
  const base = blankRecord(recordId, url, "fetch_failed");
  const code = Number(status);
  if (code <= 0) return base;
  if (code >= 400) return { ...base, reason: "http_error" };
  const text = body || "";
  if (!String(text).trim()) return { ...base, reason: "empty_body" };
  if (text.length > BODY_CAP) return { ...base, reason: "body_too_large" };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...base, reason: "not_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...base, reason: "not_json" };
  const data = parsed.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ...base, reason: "missing_data" };
  if (!isInt(data.id) || String(data.id) !== String(recordId)) return { ...base, reason: "id_mismatch" };
  if (typeof data.status !== "string") return { ...base, reason: "bad_status" };
  const statusText = data.status.trim().toLowerCase().split(/\s+/).join(" ");
  if (!STATUS.test(statusText)) return { ...base, reason: "bad_status" };
  if (!isInt(data.progress) || data.progress < 0 || data.progress > 100) return { ...base, reason: "bad_progress" };
  const player = data.player;
  if (!player || typeof player !== "object") return { ...base, reason: "missing_player" };
  if (!isInt(player.id) || player.id <= 0 || player.id > 999999999) return { ...base, reason: "missing_player" };
  if (typeof player.banned !== "boolean") return { ...base, reason: "bad_banned" };
  const demon = data.demon;
  if (!demon || typeof demon !== "object") return { ...base, reason: "missing_demon" };
  if (!isInt(demon.id) || demon.id <= 0 || demon.id > 999999999) return { ...base, reason: "missing_demon" };
  let date = data.date == null ? "" : data.date;
  if (typeof date !== "string") return { ...base, reason: "bad_date" };
  date = date.trim();
  if (date) {
    try {
      recordUnix(date);
    } catch {
      return { ...base, reason: "bad_date" };
    }
  }
  return {
    ...base,
    ok: "1",
    status: statusText,
    progress: String(data.progress),
    player_id: String(player.id),
    player_banned: player.banned ? "1" : "0",
    demon_id: String(demon.id),
    record_date: date,
    video: cleanVideo(data.video),
    reason: "ok",
  };
}

export function judge(bounty, extracted) {
  if (!extracted || extracted.ok !== "1") {
    return { outcome: "hold", reason: extracted?.reason || "fetch_failed" };
  }
  if (extracted.source !== recordUrl(String(extracted.record_id))) return { outcome: "hold", reason: "bad_source" };
  if (String(extracted.player_banned) === "1") return { outcome: "hold", reason: "player_banned" };
  if (String(extracted.player_id) !== String(bounty.player_id)) return { outcome: "hold", reason: "player_mismatch" };
  if (String(extracted.demon_id) !== String(bounty.demon_id)) return { outcome: "hold", reason: "demon_mismatch" };
  if (String(extracted.status) !== "approved") return { outcome: "hold", reason: "not_approved" };
  if (Number(extracted.progress) < Number(bounty.min_progress)) return { outcome: "hold", reason: "progress_short" };
  if (String(bounty.fresh) === "1") {
    if (!extracted.record_date) return { outcome: "hold", reason: "missing_date" };
    let stamp;
    try {
      stamp = recordUnix(String(extracted.record_date));
    } catch {
      return { outcome: "hold", reason: "bad_date" };
    }
    if (stamp < Number(bounty.opened_at)) return { outcome: "hold", reason: "record_too_old" };
  }
  return { outcome: "pay", reason: PAY_REASON };
}

export function recordsEquivalent(left, right) {
  if (!left || !right) return false;
  return DECISION_FIELDS.every((key) => String(left[key] ?? "") === String(right[key] ?? ""));
}

export function claimAllowed(status, deadlineAt, now) {
  return status === "OPEN" && Number(now) < Number(deadlineAt);
}

export function refundAllowed(status, deadlineAt, now) {
  return status === "OPEN" && Number(now) >= Number(deadlineAt);
}

export function formatGen(wei) {
  const value = BigInt(wei || 0);
  const whole = value / 10n ** 18n;
  const frac = (value % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function parseGen(text) {
  const raw = String(text || "").trim();
  if (!/^\d+(\.\d{1,18})?$/.test(raw)) throw fail("bad_amount");
  const [whole, frac = ""] = raw.split(".");
  const padded = `${frac}${"0".repeat(18)}`.slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(padded);
}

export function sameTerms(left, right) {
  const keys = ["label", "note", "demon_id", "player_id", "min_progress", "fresh", "deadline_secs", "payee"];
  return keys.every((key) => String(left?.[key] ?? "") === String(right?.[key] ?? ""));
}
