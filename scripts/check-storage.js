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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "math-clash-storage-"));
  const stateFile = path.join(dir, "state.json");
  const storage = createStorage({ stateFile });
  const state = normalizeState(storage.loadState());

  assert(storage.info().provider.includes("json"), "storage provider available");
  assert(state.matches && state.players && state.xpEvents, "default state has required collections");
  assert(state.pokerLobby && typeof state.pokerLobby === "object", "default state has poker lobby");
  assert(state.pokerLobby.playerTables && typeof state.pokerLobby.playerTables === "object", "poker lobby tracks player tables");
  assert(state.pokerTables && typeof state.pokerTables === "object", "default state has poker tables");
  assert(state.chatMessages && typeof state.chatMessages === "object", "default state has persistent chat collection");
  assert(state.socialTasks.share_result, "default social tasks are seeded");

  const now = new Date().toISOString();
  state.players["wallet:0xabc"] = {
    id: "wallet:0xabc",
    fid: null,
    walletAddress: "0xabc",
    username: null,
    xp: 10,
    createdAt: now,
    updatedAt: now
  };
  state.chatMessages.chat_test = {
    id: "chat_test",
    playerId: "wallet:0xabc",
    display: "0xabc",
    text: "hi",
    createdAt: now
  };
  state.pokerLobby.waitingTableId = "0x" + "1".repeat(64);
  state.pokerLobby.playerTables["0x0000000000000000000000000000000000000abc"] = state.pokerLobby.waitingTableId;
  state.pokerTables[state.pokerLobby.waitingTableId] = {
    id: state.pokerLobby.waitingTableId,
    status: "waiting",
    stage: "waiting",
    player1: "0x0000000000000000000000000000000000000abc",
    player2: "",
    stake: "0.0001",
    handId: 1,
    fair: {
      version: "vrf-v1",
      handId: 1,
      commits: {},
      reveals: {},
      vrfRequestId: "1",
      vrfWord: "123",
      vrfReady: true,
      seed: "",
      deckHash: ""
    },
    createdAt: now,
    updatedAt: now
  };
  storage.saveState(state);

  const reloaded = normalizeState(storage.loadState());
  assert(reloaded.players["wallet:0xabc"].xp === 10, "player persists after reload");
  assert(reloaded.chatMessages.chat_test.text === "hi", "chat message persists after reload");
  assert(
    reloaded.pokerTables[reloaded.pokerLobby.waitingTableId].stage === "waiting",
    "poker table state persists after reload"
  );
  assert(
    reloaded.pokerLobby.playerTables["0x0000000000000000000000000000000000000abc"] === reloaded.pokerLobby.waitingTableId,
    "player table index persists after reload"
  );
  assert(reloaded.pokerTables[reloaded.pokerLobby.waitingTableId].fair.version === "vrf-v1", "VRF fair state persists");
  assert(reloaded.socialTasks.invite_friend.xpReward === 50, "social task data persists");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("");
  console.log("Storage check passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
