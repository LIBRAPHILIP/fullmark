import deployed from "./deployed.json";
import {
  claimAllowed,
  extractRecord,
  formatGen,
  judge,
  parseGen,
  parseTerms,
  recordUrl,
  sameTerms,
  MIN_ESCROW_WEI,
  VERSION,
} from "./genlayer/rules.js";
import {
  connectInjectedWallet,
  fundStudioAccount,
  getActiveAccount,
  getWalletMode,
  probeNetworkHealth,
  readBalance,
  setNetwork,
  useEphemeralAccount,
} from "./genlayer/client.js";
import { explorerAddressUrl, explorerTxUrl, getNetwork } from "./genlayer/networks.js";
import {
  appealBounty,
  claimBounty,
  consentUnwind,
  deployFullmark,
  finalizeBounty,
  fetchConsensusSnapshot,
  loadSavedAddress,
  openBounty,
  previewOpen,
  previewRecord,
  readBounties,
  readBounty,
  readMeta,
  refundBounty,
  saveAddress,
  statusNameOf,
  summarizeConsensus,
  unwindBounty,
} from "./genlayer/fullmark.js";

const $ = (id) => document.getElementById(id);

const state = {
  address: "",
  account: "",
  busy: false,
  bounties: [],
  life: { phase: "", txHash: "", canAppeal: false },
};

function fields() {
  return {
    label: $("label").value,
    note: $("note").value,
    demonId: $("demonId").value.trim(),
    playerId: $("playerId").value.trim(),
    minProgress: $("minProgress").value.trim(),
    fresh: $("fresh").value,
    deadlineSecs: $("deadline").value,
    payee: $("payee").value.trim(),
    recordId: $("previewRecord").value.trim(),
  };
}

function setBusy(busy) {
  state.busy = busy;
  for (const id of ["btnOpen", "btnPreview", "btnDeploy", "btnBind", "btnFaucet", "btnEphemeral", "btnWallet"]) {
    const node = $(id);
    if (node) node.disabled = busy;
  }
}

function setLife(patch) {
  state.life = { ...state.life, ...patch };
  const phase = state.life.phase || "";
  $("life").classList.toggle("error", phase === "error");
  $("lifeMessage").textContent = state.life.message || "";
  for (const node of $("lifePhases").querySelectorAll("span")) {
    node.classList.toggle("on", node.dataset.phase === phase);
  }
  const link = $("lifeTx");
  const href = explorerTxUrl(getNetwork($("networkSelect").value), state.life.txHash);
  if (state.life.txHash && href) {
    link.hidden = false;
    link.href = href;
    link.textContent = `${state.life.txHash.slice(0, 10)}…${state.life.txHash.slice(-6)}`;
  } else if (state.life.txHash) {
    link.hidden = false;
    link.removeAttribute("href");
    link.textContent = state.life.txHash;
  } else {
    link.hidden = true;
  }
  $("btnRefreshTx").hidden = !state.life.txHash;
  $("btnAppeal").hidden = !state.life.canAppeal;
  $("btnFinalize").hidden = !state.life.txHash;
  const facts = $("lifeFacts");
  facts.replaceChildren();
  for (const [term, value] of state.life.facts || []) {
    const wrap = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    wrap.append(dt, dd);
    facts.append(wrap);
  }
}

function onProgress(patch) {
  const status = statusNameOf(patch);
  const facts = summarizeConsensus(patch);
  if (patch.txHash) facts.unshift(["Tx", patch.txHash]);
  setLife({
    phase: patch.phase || "consensus",
    message: patch.message || status || "Working…",
    txHash: patch.txHash || state.life.txHash,
    canAppeal: Boolean(patch.canAppeal),
    facts,
  });
}

function safeHttps(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function pill(status) {
  const node = document.createElement("span");
  const key = status === "PAID" ? "paid" : status === "OPEN" ? "open" : "closed";
  node.className = `pill ${key}`;
  node.textContent = status || "UNKNOWN";
  return node;
}

function renderBounties() {
  const root = $("bountyList");
  root.replaceChildren();
  if (!state.bounties.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = state.address
      ? "No bounties on this contract yet."
      : "Bind a Fullmark address to read the desk.";
    root.append(empty);
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  for (const bounty of state.bounties) {
    const card = document.createElement("article");
    card.className = `ticket${bounty.status === "PAID" ? " is-paid" : ""}`;
    card.dataset.id = bounty.bounty_id;

    const index = document.createElement("div");
    index.className = "ticket-index";
    index.append(document.createTextNode(String(bounty.bounty_id).padStart(2, "0")));
    const kind = document.createElement("span");
    kind.textContent = bounty.fresh === "1" ? "Fresh" : "Standing";
    index.append(kind);

    const body = document.createElement("div");
    body.append(pill(bounty.status));
    const title = document.createElement("h3");
    title.textContent = bounty.label || "Untitled bounty";
    const meta = document.createElement("p");
    meta.className = "meta-line";
    const escrow = formatGen(bounty.escrow_wei || "0");
    meta.textContent = `demon ${bounty.demon_id} · player ${bounty.player_id} · bar ${bounty.min_progress}% · ${escrow} GEN`;
    const note = document.createElement("p");
    note.textContent = bounty.note || "";
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    const shown = bounty.status === "PAID" ? Number(bounty.progress || 0) : Number(bounty.min_progress || 0);
    fill.style.width = `${Math.max(0, Math.min(100, shown))}%`;
    bar.append(fill);
    const detail = document.createElement("p");
    detail.className = "meta-line";
    const bits = [
      `sponsor ${bounty.sponsor}`,
      `payee ${bounty.payee}`,
      bounty.settlement_basis ? `basis ${bounty.settlement_basis}` : "",
      bounty.record_id ? `record ${bounty.record_id}` : "",
      bounty.record_date ? bounty.record_date : "",
    ].filter(Boolean);
    detail.textContent = bits.join(" · ");
    body.append(title, meta, note, bar, detail);

    if (bounty.source) {
      const source = document.createElement("p");
      source.className = "meta-line";
      const href = safeHttps(bounty.source);
      if (href) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = href;
        source.append("Source ", link);
      } else {
        source.textContent = bounty.source;
      }
      body.append(source);
    }
    if (bounty.video) {
      const videoHref = safeHttps(bounty.video);
      if (videoHref) {
        const line = document.createElement("p");
        line.className = "meta-line";
        const link = document.createElement("a");
        link.href = videoHref;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "Approved video";
        line.append(link);
        body.append(line);
      }
    }

    if (bounty.status === "OPEN") {
      const actions = document.createElement("div");
      actions.className = "actions";
      const record = document.createElement("input");
      record.className = "record-id";
      record.inputMode = "numeric";
      record.placeholder = "Record id";
      record.value = bounty.demon_id === "1" && bounty.player_id === "575" ? "12672" : "";
      const claim = document.createElement("button");
      claim.type = "button";
      claim.className = "solid";
      claim.dataset.act = "claim";
      claim.textContent = "File record";
      const consent = document.createElement("button");
      consent.type = "button";
      consent.className = "ghost";
      consent.dataset.act = "consent";
      consent.textContent = `Consent ${bounty.sponsor_unwind}/${bounty.payee_unwind}`;
      const unwind = document.createElement("button");
      unwind.type = "button";
      unwind.className = "ghost";
      unwind.dataset.act = "unwind";
      unwind.textContent = "Unwind";
      const refund = document.createElement("button");
      refund.type = "button";
      refund.className = "ghost";
      refund.dataset.act = "refund";
      refund.textContent = claimAllowed(bounty.status, bounty.deadline_at, now) ? "Refund after deadline" : "Refund";
      actions.append(record, claim, consent, unwind, refund);
      body.append(actions);
    }

    card.append(index, body);
    root.append(card);
  }
}

async function refreshAccount() {
  const account = getActiveAccount();
  const mode = getWalletMode();
  state.account = typeof account === "string" ? account : account?.address || "";
  if (!state.account) {
    $("accountLine").textContent = "No account yet. An ephemeral Studionet account can be funded from the studio faucet.";
    return;
  }
  let balance = "";
  try {
    balance = `${formatGen(await readBalance(state.account))} GEN`;
  } catch (error) {
    balance = error.message;
  }
  $("accountLine").textContent = `${mode} ${state.account} · ${balance}`;
  if (!$("payee").value.trim()) $("payee").value = state.account;
}

async function refreshMeta() {
  if (!state.address) {
    $("metaLine").textContent = "Bind a deployed Fullmark address, or deploy this source.";
    return;
  }
  try {
    const meta = await readMeta(state.address);
    const version = String(meta?.version || "");
    const llm = String(meta?.llm_rule || "");
    const count = String(meta?.bounty_count || "0");
    const warn = version !== VERSION || llm !== "none" ? " This build does not match the page." : "";
    $("metaLine").textContent = `${version} · ${count} bounties · llm ${llm || "missing"} · host ${meta?.host || "unknown"}.${warn}`;
    const href = explorerAddressUrl(getNetwork($("networkSelect").value), state.address);
    if (href) {
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = " Explorer";
      $("metaLine").append(link);
    }
  } catch (error) {
    $("metaLine").textContent = `Meta failed: ${error.message}`;
  }
}

async function refreshDesk() {
  if (!state.address) {
    state.bounties = [];
    renderBounties();
    return;
  }
  state.bounties = await readBounties(state.address);
  renderBounties();
}

async function preview() {
  const draft = fields();
  let terms;
  try {
    terms = parseTerms(draft);
  } catch (error) {
    $("localPreview").textContent = error.message || String(error);
    return;
  }
  const lines = [
    `Pins: demon ${terms.demon_id}, player ${terms.player_id}, bar ${terms.min_progress}%, fresh ${terms.fresh}.`,
    `Payee ${terms.payee}.`,
  ];
  if (state.address) {
    try {
      const remote = await previewOpen(state.address, draft);
      if (remote?.error) lines.push(`Contract preview rejected the form: ${remote.error}`);
      else if (!sameTerms(terms, remote)) lines.push("Contract preview does not match this page. The deposit stays here.");
      else lines.push("Contract preview matches this form.");
    } catch (error) {
      lines.push(`Contract preview failed: ${error.message}`);
    }
  }
  if (draft.recordId) {
    let url = "";
    try {
      url = recordUrl(draft.recordId.replace(/\s/g, ""));
      const parsedId = draft.recordId.trim();
      if (!/^[1-9][0-9]{0,8}$/.test(parsedId)) throw new Error("bad_record");
      lines.push(`Browser would read ${url}`);
      if (state.address) {
        const remote = await previewRecord(state.address, parsedId);
        if (remote?.error) lines.push(`Contract record preview: ${remote.error}`);
        else if (remote?.source !== url) lines.push("Contract URL does not match this page. Claim stays disabled until they match.");
        else lines.push("Contract URL matches.");
      }
      const response = await fetch(url);
      const text = await response.text();
      const extracted = extractRecord(text, response.status, parsedId, url);
      const verdict = judge(
        {
          ...terms,
          opened_at: String(Math.floor(Date.now() / 1000)),
        },
        extracted
      );
      lines.push(
        `Browser preview: ${verdict.outcome} (${verdict.reason}). Status ${extracted.status || "none"}, progress ${extracted.progress}. This is not the decision.`
      );
    } catch (error) {
      lines.push(`Record preview failed: ${error.message || error}`);
    }
  }
  $("localPreview").textContent = lines.join(" ");
}

async function runTx(work) {
  if (state.busy) return;
  setBusy(true);
  try {
    await work();
    await refreshDesk();
    await refreshAccount();
    await refreshMeta();
  } catch (error) {
    setLife({
      phase: "error",
      message: error.message || String(error),
      txHash: state.life.txHash,
      facts: state.life.facts || [],
    });
  } finally {
    setBusy(false);
  }
}

function requireReady() {
  if (!state.account) throw new Error("Create an ephemeral account or connect a wallet first.");
  if (!state.address) throw new Error("Bind or deploy the Fullmark contract first.");
}

async function onOpen(event) {
  event.preventDefault();
  await runTx(async () => {
    requireReady();
    const draft = fields();
    const terms = parseTerms(draft);
    const valueWei = parseGen($("amount").value);
    if (valueWei < MIN_ESCROW_WEI) throw new Error("escrow_too_small");
    const remote = await previewOpen(state.address, draft);
    if (remote?.error) throw new Error(remote.error);
    if (!sameTerms(terms, remote)) throw new Error("The contract preview does not match this form.");
    await openBounty(state.address, { ...draft, valueWei }, { onProgress });
  });
}

$("openForm").addEventListener("submit", onOpen);
$("btnPreview").addEventListener("click", () => preview().catch((error) => {
  $("localPreview").textContent = error.message || String(error);
}));
$("btnUseAccount").addEventListener("click", () => {
  if (state.account) $("payee").value = state.account;
});

$("bountyList").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button || state.busy) return;
  const card = button.closest("[data-id]");
  const bountyId = card?.dataset.id;
  if (!bountyId) return;
  const recordId = card.querySelector(".record-id")?.value || "";
  const act = button.dataset.act;
  runTx(async () => {
    requireReady();
    if (act === "claim") await claimBounty(state.address, bountyId, recordId.trim(), { onProgress });
    if (act === "refund") await refundBounty(state.address, bountyId, { onProgress });
    if (act === "consent") await consentUnwind(state.address, bountyId, { onProgress });
    if (act === "unwind") await unwindBounty(state.address, bountyId, { onProgress });
  });
});

$("btnEphemeral").addEventListener("click", () => runTx(async () => {
  const account = useEphemeralAccount();
  state.account = account.address;
  await refreshAccount();
  setLife({ phase: "", message: `Ephemeral account ${account.address}. Fund it before opening a bounty.`, txHash: "", facts: [] });
}));

$("btnWallet").addEventListener("click", () => runTx(async () => {
  const account = await connectInjectedWallet();
  state.account = account.address;
  await refreshAccount();
}));

$("btnFaucet").addEventListener("click", () => runTx(async () => {
  if (!state.account) throw new Error("Create an account first.");
  setLife({ phase: "submitting", message: "Requesting studio funds…", txHash: "", facts: [] });
  const hash = await fundStudioAccount(state.account);
  setLife({ phase: "accepted", message: "Fund request accepted.", txHash: hash || "", facts: [] });
  await refreshAccount();
}));

$("btnBind").addEventListener("click", () => runTx(async () => {
  const address = $("contractAddress").value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Enter a 0x contract address.");
  state.address = address;
  saveAddress(address);
  await refreshMeta();
  await refreshDesk();
}));

$("btnDeploy").addEventListener("click", () => runTx(async () => {
  if (!state.account) throw new Error("Create an account first.");
  const result = await deployFullmark({ onProgress });
  state.address = result.address;
  $("contractAddress").value = result.address;
  await refreshMeta();
}));

$("loadForm").addEventListener("submit", (event) => {
  event.preventDefault();
  runTx(async () => {
    requireReady();
    const row = await readBounty(state.address, $("loadId").value.trim());
    if (!row || row.error) throw new Error(row?.error || "bounty_not_found");
    const rest = state.bounties.filter((item) => item.bounty_id !== row.bounty_id);
    state.bounties = [row, ...rest];
    renderBounties();
  });
});

$("networkSelect").addEventListener("change", () => {
  setNetwork($("networkSelect").value);
  refreshAccount().catch(() => {});
  probe();
});

$("btnRefreshTx").addEventListener("click", () => runTx(async () => {
  if (!state.life.txHash) return;
  const snapshot = await fetchConsensusSnapshot(state.life.txHash);
  setLife({
    phase: "consensus",
    message: statusNameOf(snapshot) || "Status refreshed.",
    txHash: state.life.txHash,
    canAppeal: Boolean(snapshot.canAppeal),
    facts: summarizeConsensus(snapshot),
  });
}));

$("btnAppeal").addEventListener("click", () => runTx(async () => {
  if (!state.life.txHash) return;
  await appealBounty(state.life.txHash, { onProgress });
}));

$("btnFinalize").addEventListener("click", () => runTx(async () => {
  if (!state.life.txHash) return;
  await finalizeBounty(state.life.txHash, { onProgress });
}));

async function probe() {
  const health = await probeNetworkHealth();
  $("healthPip").classList.toggle("ok", health.ok);
  $("healthPip").classList.toggle("bad", !health.ok);
  $("healthText").textContent = health.ok
    ? `${health.label} · chain ${health.chainId} · ${health.latencyMs} ms`
    : `${health.label} unreachable${health.error ? ` · ${health.error}` : ""}`;
}

function startField() {
  const canvas = $("listfield");
  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let rows = [];
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rows = Array.from({ length: 16 }, (_, index) => ({
      y: (index / 16) * rect.height,
      progress: 28 + ((index * 19) % 70),
      hot: index % 6 === 2,
    }));
  }
  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    ctx.font = "12px 'IBM Plex Mono', monospace";
    for (const row of rows) {
      if (!reduce) {
        row.y += row.hot ? 0.35 : 0.18;
        if (row.y > height + 16) row.y = -16;
      }
      ctx.globalAlpha = row.hot ? 0.85 : 0.22;
      ctx.fillStyle = row.hot ? "#d6ff4a" : "#efe7d6";
      const bar = (row.progress / 100) * width * 0.42;
      ctx.fillRect(width * 0.08, row.y, bar, row.hot ? 3 : 1);
    }
    ctx.globalAlpha = 1;
    if (!reduce) requestAnimationFrame(draw);
  }
  resize();
  draw();
  window.addEventListener("resize", () => {
    resize();
    if (reduce) draw();
  });
}

const hero = $("hero");
hero.addEventListener("pointermove", (event) => {
  const rect = hero.getBoundingClientRect();
  hero.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  hero.style.setProperty("--my", `${event.clientY - rect.top}px`);
});

state.address = loadSavedAddress() || deployed.address || "";
$("contractAddress").value = state.address;
if (deployed.network && $("networkSelect").querySelector(`option[value="${deployed.network}"]`)) {
  $("networkSelect").value = deployed.network;
}
setNetwork($("networkSelect").value);
startField();
probe();
setInterval(() => probe().catch(() => {}), 30000);
refreshMeta().catch(() => {});
refreshDesk().catch((error) => {
  $("metaLine").textContent = error.message || String(error);
});
