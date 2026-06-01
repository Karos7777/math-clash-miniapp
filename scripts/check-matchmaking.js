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
  state.pokerLobby.playerTables["0x1111111111111111111111111111111111111111"] = tableId;
  state.pokerTables[tableId] = {
    id: tableId,
    status: "waiting",
    stage: "waiting",
    maxSeats: 6,
    players: ["0x1111111111111111111111111111111111111111"],
    player1: "0x1111111111111111111111111111111111111111",
    player2: "",
    stake: "0.0001",
    createdAt: now,
    updatedAt: now
  };
  storage.saveState(state);

  const reloaded = normalizeState(storage.loadState());
  assert(reloaded.pokerLobby.waitingTableId === tableId, "waiting table survives refresh simulation");
  assert(
    reloaded.pokerLobby.playerTables["0x1111111111111111111111111111111111111111"] === tableId,
    "player-to-table index survives refresh simulation"
  );

  const table = reloaded.pokerTables[tableId];
  table.players.push("0x2222222222222222222222222222222222222222");
  table.player2 = "0x2222222222222222222222222222222222222222";
  table.status = "waiting";
  table.stage = "waiting";
  reloaded.pokerLobby.waitingTableId = "";
  reloaded.pokerLobby.playerTables["0x2222222222222222222222222222222222222222"] = tableId;
  storage.saveState(reloaded);

  const matched = normalizeState(storage.loadState()).pokerTables[tableId];
  assert(matched.player1 && matched.player2, "second player can fill waiting table");
  assert(Array.isArray(matched.players) && matched.players.length === 2, "visible table tracks seated players");
  assert(matched.stage === "waiting", "matched table stays open until players start on-chain hand");
  assert(
    normalizeState(storage.loadState()).pokerLobby.playerTables["0x2222222222222222222222222222222222222222"] === tableId,
    "second player can restore matched table"
  );

  const expiredTableId = "0x" + "3".repeat(64);
  const expiredState = normalizeState(storage.loadState());
  expiredState.pokerLobby.tableIds.push(expiredTableId);
  expiredState.pokerLobby.waitingTableId = expiredTableId;
  expiredState.pokerTables[expiredTableId] = {
    id: expiredTableId,
    status: "waiting",
    stage: "waiting",
    maxSeats: 6,
    players: ["0x3333333333333333333333333333333333333333"],
    player1: "0x3333333333333333333333333333333333333333",
    onChain: false,
    createdAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString()
  };
  const ttlMs = 10 * 60 * 1000;
  const stale = expiredState.pokerTables[expiredTableId];
  const timestamp = Date.parse(stale.updatedAt || stale.createdAt || "");
  if (Date.now() - timestamp > ttlMs && stale.players.length < 2 && !stale.onChain) {
    delete expiredState.pokerTables[expiredTableId];
    expiredState.pokerLobby.waitingTableId = "";
  }
  storage.saveState(expiredState);
  const cleaned = normalizeState(storage.loadState());
  assert(!cleaned.pokerTables[expiredTableId], "stale empty waiting table can be removed after 10 minutes");
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
