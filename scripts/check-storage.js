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
  storage.saveState(state);

  const reloaded = normalizeState(storage.loadState());
  assert(reloaded.players["wallet:0xabc"].xp === 10, "player persists after reload");
  assert(reloaded.chatMessages.chat_test.text === "hi", "chat message persists after reload");
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
