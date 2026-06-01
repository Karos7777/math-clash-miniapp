const { keccak256, solidityPacked, toUtf8Bytes } = require("ethers");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`OK ${message}`);
}

function shuffleDeck(seed) {
  const deck = [];
  const suits = ["s", "h", "d", "c"];
  const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
  for (const rank of ranks) {
    for (const suit of suits) deck.push(`${rank}${suit}`);
  }

  let hash = hashSeed(seed);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const j = hash % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deckHash(deck) {
  return keccak256(toUtf8Bytes(deck.join("|")));
}

function main() {
  const tableId = `0x${"12".repeat(32)}`;
  const player1 = "0x1111111111111111111111111111111111111111";
  const player2 = "0x2222222222222222222222222222222222222222";
  const handId = 1n;
  const secret1 = "local-secret-player-1";
  const secret2 = "local-secret-player-2";
  const chainId = 84532n;
  const contract = "0x3333333333333333333333333333333333333333";

  const commit1 = keccak256(solidityPacked(["string", "address", "bytes32", "uint256"], [secret1, player1, tableId, handId]));
  const commit2 = keccak256(solidityPacked(["string", "address", "bytes32", "uint256"], [secret2, player2, tableId, handId]));
  assert(commit1 !== commit2, "different players/secrets produce different commits");

  const seed = keccak256(
    solidityPacked(
      ["string", "string", "bytes32", "uint256", "uint256", "address"],
      [secret1, secret2, tableId, handId, chainId, contract]
    )
  );
  const deckA = shuffleDeck(seed);
  const deckB = shuffleDeck(seed);
  const deckC = shuffleDeck(`${seed}:changed`);

  assert(deckA.length === 52, "deck has 52 cards");
  assert(new Set(deckA).size === 52, "deck has no repeated cards");
  assert(deckA.join("|") === deckB.join("|"), "same seed gives the same deck");
  assert(deckA.join("|") !== deckC.join("|"), "different seed changes deck order");
  assert(/^0x[a-fA-F0-9]{64}$/.test(deckHash(deckA)), "deck hash is bytes32");

  console.log("");
  console.log("Commit-reveal shuffle check passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
