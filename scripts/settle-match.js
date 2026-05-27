require("dotenv").config();

const matchId = process.argv[2];
if (!matchId) {
  console.error("Usage: npm run settle:match -- match_id");
  process.exit(1);
}

const port = process.env.PORT || "4173";
const adminToken = process.env.SETTLEMENT_ADMIN_TOKEN || "";

async function main() {
  const response = await fetch(`http://localhost:${port}/api/matches/${encodeURIComponent(matchId)}/settle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "x-admin-token": adminToken } : {})
    },
    body: "{}"
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  const settlement = payload.payment?.settlement;
  console.log("Match:", payload.matchId);
  console.log("Status:", payload.status);
  console.log("Settlement:", settlement?.status || "unknown");
  if (settlement?.txHash) {
    console.log("Settlement tx:", settlement.txHash);
  }
  if (settlement?.error) {
    console.log("Settlement error:", settlement.error);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
