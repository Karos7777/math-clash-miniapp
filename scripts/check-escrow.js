require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const ABI = [
  "function owner() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function paused() view returns (bool)",
  "function gameState() view returns (uint8)",
  "function MAX_SEATS() view returns (uint8)",
  "function seatCount() view returns (uint8)",
  "function getSeats() view returns (address[6])",
  "function handAnte() view returns (uint256)",
  "function minBuyIn() view returns (uint256)",
  "function ACTION_TIMEOUT() view returns (uint256)",
  "function DEVELOPER_FEE_BPS() view returns (uint256)",
  "function getPlayers() view returns (address,address)",
  "function roundNumber() view returns (uint256)",
  "function roundPot() view returns (uint256)"
];

const DEFAULT_RPC = "https://sepolia.base.org";
const BASE_SEPOLIA_CHAIN_ID = 84532;
const EXPECTED_DEVELOPER_FEE_BPS = 200n;
const EXPECTED_TIMEOUT = 300n;

function readPublicConfigAddress() {
  const configPath = path.join(__dirname, "..", "public", "config.js");
  const config = fs.readFileSync(configPath, "utf8");
  const gameMatch = config.match(/gameContractAddress:\s*["'](0x[a-fA-F0-9]{40})["']/);
  if (gameMatch) return gameMatch[1];
  const legacyMatch = config.match(/escrowAddress:\s*["'](0x[a-fA-F0-9]{40})["']/);
  return legacyMatch ? legacyMatch[1] : "";
}

function sameAddress(a, b) {
  return a && b && a.toLowerCase() === b.toLowerCase();
}

function statusLine(label, ok, detail) {
  console.log(`${ok ? "OK" : "CHECK"} ${label}: ${detail}`);
}

async function main() {
  const publicAddress = readPublicConfigAddress();
  const contractAddress = process.env.GAME_CONTRACT_ADDRESS || process.env.ESCROW_CONTRACT_ADDRESS || publicAddress;

  if (!ethers.isAddress(contractAddress || "")) {
    throw new Error("Set GAME_CONTRACT_ADDRESS, ESCROW_CONTRACT_ADDRESS, or public/config.js gameContractAddress");
  }

  const rpcUrl = process.env.BASE_RPC_URL || process.env.BASE_SEPOLIA_RPC_URL || DEFAULT_RPC;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const chainId = Number((await provider.getNetwork()).chainId);

  statusLine("network", chainId === BASE_SEPOLIA_CHAIN_ID, `chainId=${chainId}`);

  const code = await provider.getCode(contractAddress);
  statusLine("contract code", code !== "0x", contractAddress);
  if (code === "0x") {
    throw new Error("No contract code found at game contract address");
  }

  const requiredSelectors = [
    "joinGame()",
    "joinSeat(uint8)",
    "topUpStack()",
    "payAnte()",
    "commitNumber(bytes32)",
    "bet(uint256)",
    "call()",
    "raiseBet(uint256)",
    "check()",
    "fold()",
    "reveal(uint8,bytes32)",
    "cashOutStack()",
    "claimWinnings()",
    "timeout()",
    "pause()",
    "unpause()"
  ];

  console.log("");
  console.log("Required function selectors:");
  const selectorResults = requiredSelectors.map((signature) => {
    const selector = ethers.id(signature).slice(2, 10);
    const found = code.includes(selector);
    statusLine(signature, found, `0x${selector}`);
    return { signature, found };
  });

  const table = new ethers.Contract(contractAddress, ABI, provider);
  const owner = await table.owner();
  const feeRecipient = await table.feeRecipient();
  const paused = await table.paused();
  const gameState = await table.gameState();
  const maxSeats = await table.MAX_SEATS();
  const seatCount = await table.seatCount();
  const seats = await table.getSeats();
  const handAnte = await table.handAnte();
  const minBuyIn = await table.minBuyIn();
  const timeout = await table.ACTION_TIMEOUT();
  const feeBps = await table.DEVELOPER_FEE_BPS();
  const [player1, player2] = await table.getPlayers();
  const roundNumber = await table.roundNumber();
  const roundPot = await table.roundPot();

  console.log("");
  console.log("Poker table:", contractAddress);
  console.log("Owner:", owner);
  console.log("Fee recipient:", feeRecipient);
  console.log("Paused:", paused);
  console.log("State:", gameState.toString());
  console.log("Max seats:", maxSeats.toString());
  console.log("Seat count:", seatCount.toString());
  console.log("Seats:", seats.join(", "));
  console.log("Hand ante:", handAnte.toString());
  console.log("Min buy-in:", minBuyIn.toString());
  console.log("Timeout seconds:", timeout.toString());
  console.log("Developer fee bps:", feeBps.toString());
  console.log("Player 1:", player1);
  console.log("Player 2:", player2);
  console.log("Hand:", roundNumber.toString());
  console.log("Pot:", roundPot.toString());
  console.log("");

  statusLine("public/config.js address", sameAddress(contractAddress, publicAddress), publicAddress || "not set");
  statusLine("developer fee is 2% per hand", BigInt(feeBps) === EXPECTED_DEVELOPER_FEE_BPS, feeBps.toString());
  statusLine("action timeout is 5 minutes", BigInt(timeout) === EXPECTED_TIMEOUT, timeout.toString());
  statusLine("table has 6 seats", Number(maxSeats) === 6, maxSeats.toString());
  statusLine("min buy-in covers at least 2 antes", BigInt(minBuyIn) >= BigInt(handAnte) * 2n, minBuyIn.toString());

  if (
    selectorResults.some((item) => !item.found) ||
    BigInt(feeBps) !== EXPECTED_DEVELOPER_FEE_BPS ||
    BigInt(timeout) !== EXPECTED_TIMEOUT ||
    Number(maxSeats) !== 6 ||
    BigInt(minBuyIn) < BigInt(handAnte) * 2n
  ) {
    throw new Error("Poker table check failed. Confirm this address was deployed from contracts/Escrow.sol");
  }

  console.log("");
  console.log("On-chain poker table check passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
