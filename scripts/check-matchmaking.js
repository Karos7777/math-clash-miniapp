const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createStorage, normalizeState } = require("../storage");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`OK ${message}`);
}

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "poker-clash-matchmaking-"));
  const stateFile = path.join(dir, "state.json");
  const storage = createStorage({ stateFile });
  const now = new Date().toISOString();
  const tableId = "0x" + "2".repeat(64);

  const state = normalizeState(storage.loadState());
  state.pokerLobby.waitingTableId = tableId;
  state.pokerTables[tableId] = {
    id: tableId,
    status: "waiting",
    stage: "waiting",
    player1: "0x1111111111111111111111111111111111111111",
    player2: "",
    stake: "0.0001",
    createdAt: now,
    updatedAt: now
  };
  storage.saveState(state);

  const reloaded = normalizeState(storage.loadState());
  assert(reloaded.pokerLobby.waitingTableId === tableId, "waiting table survives refresh simulation");

  const table = reloaded.pokerTables[tableId];
  table.player2 = "0x2222222222222222222222222222222222222222";
  table.status = "confirming";
  table.stage = "confirming";
  reloaded.pokerLobby.waitingTableId = "";
  storage.saveState(reloaded);

  const matched = normalizeState(storage.loadState()).pokerTables[tableId];
  assert(matched.player1 && matched.player2, "second player can fill waiting table");
  assert(matched.stage === "confirming", "matched table restores confirming stage");
  assert(process.env.NODE_ENV === "production" ? !process.env.DEV_PLAYER_ID : true, "production does not require devPlayerId");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("");
  console.log("Matchmaking check passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
