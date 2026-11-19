/**
 * Open a standing prize and claim Pointercrate record 12672.
 * Uses the deployer key written by scripts/deploy.mjs. The key stays local.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployed = JSON.parse(readFileSync(path.join(root, "src", "deployed.json"), "utf8"));
const signer = JSON.parse(readFileSync(path.join(root, "deploy", "deployer.local.json"), "utf8"));

const SOURCE = "https://pointercrate.com/api/v1/records/12672/";

function asObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function hardError(receipt) {
  const status = String(receipt?.statusName || receipt?.status || "");
  const result = String(receipt?.result_name || receipt?.resultName || receipt?.txExecutionResultName || "");
  if (/REJECT|ERROR|UNDETERMINED|REVERT/i.test(`${status} ${result}`)) return `${status} ${result}`.trim();
  const data = receipt?.consensus_data || {};
  const rows = [...(data.leader_receipt || []), ...(data.validators || [])];
  let success = false;
  let stderr = "";
  for (const row of rows) {
    if (String(row?.execution_result || "").toUpperCase() === "SUCCESS") success = true;
    const text = String(row?.genvm_result?.stderr || "").trim();
    if (!text || /cancelled after quorum/i.test(text)) continue;
    if (String(row?.vote || "") === "idle") continue;
    if (!stderr) stderr = text;
  }
  if (stderr && !success) return stderr.split("\n").slice(-8).join(" ");
  return "";
}

async function wait(client, hash, label) {
  console.log(label, hash);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    retries: 400,
    interval: 5000,
    fullTransaction: true,
  });
  const status = String(receipt.statusName || receipt.status || "");
  const result = String(receipt.result_name || receipt.resultName || receipt.txExecutionResultName || "");
  console.log("  status:", status, result);
  const error = hardError(receipt);
  if (error) throw new Error(`${label} failed: ${error}`);
  return receipt;
}

async function main() {
  if (!deployed.address) throw new Error("Deploy Fullmark first");
  const account = createAccount(signer.privateKey);
  const client = createClient({ chain: studionet, account });
  await client.initializeConsensusSmartContract();

  console.log("Opening standing prize for demon 1, player 575, bar 100");
  const openHash = await client.writeContract({
    address: deployed.address,
    functionName: "open_bounty",
    args: [
      "EnvY record 12672",
      "Standing prize. File Pointercrate record 12672. Fresh is off.",
      "1",
      "575",
      "100",
      "0",
      "86400",
      account.address,
    ],
    value: 2n * 10n ** 16n,
  });
  await wait(client, openHash, "open_bounty");
  const count = Number(await client.readContract({ address: deployed.address, functionName: "get_bounty_count", args: [] }));
  const bountyId = String(count - 1);
  console.log("bounty", bountyId);

  const claimHash = await client.writeContract({
    address: deployed.address,
    functionName: "claim",
    args: [bountyId, "12672"],
  });
  await wait(client, claimHash, "claim");
  const bounty = asObject(
    await client.readContract({ address: deployed.address, functionName: "get_bounty", args: [bountyId] })
  );
  console.log("final", bounty.status, bounty.settlement_basis, bounty.escrow_wei, bounty.source);
  if (bounty.status !== "PAID" || bounty.escrow_wei !== "0" || bounty.settlement_basis !== "record_approved") {
    throw new Error("claim did not pay: " + JSON.stringify(bounty));
  }
  if (bounty.source !== SOURCE || bounty.record_id !== "12672" || bounty.player_id !== "575") {
    throw new Error("paid bounty is not record 12672: " + JSON.stringify(bounty));
  }
  if (bounty.demon_id !== "1" || bounty.progress !== "100" || bounty.record_status !== "approved") {
    throw new Error("record fields mismatch: " + JSON.stringify(bounty));
  }
  if (bounty.fresh !== "0" || bounty.record_date !== "2018-05-25T12:00:00Z") {
    throw new Error("fresh or date mismatch: " + JSON.stringify(bounty));
  }
  if (String(bounty.payee).toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("payee mismatch: " + bounty.payee);
  }

  const evidence = {
    address: deployed.address,
    bountyId,
    status: bounty.status,
    settlement_basis: bounty.settlement_basis,
    escrow_wei: bounty.escrow_wei,
    source: bounty.source,
    record_id: bounty.record_id,
    player_id: bounty.player_id,
    demon_id: bounty.demon_id,
    progress: bounty.progress,
    record_status: bounty.record_status,
    record_date: bounty.record_date,
    fresh: bounty.fresh,
    video: bounty.video,
    payee: bounty.payee,
    openTx: openHash,
    claimTx: claimHash,
    checkedAt: new Date().toISOString(),
  };
  mkdirSync(path.join(root, "deployments"), { recursive: true });
  writeFileSync(path.join(root, "deployments", "live-check.json"), JSON.stringify(evidence, null, 2));
  console.log("Wrote deployments/live-check.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
