require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const ABI = [
  "function owner() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function paused() view returns (bool)",
  "function defaultStake() view returns (uint256)",
  "function defaultStreetAnte() view returns (uint256)",
  "function ACTION_TIMEOUT() view returns (uint256)",
  "function VRF_TIMEOUT() view returns (uint256)",
  "function DEVELOPER_FEE_BPS() view returns (uint256)",
  "function vrfConfigured() view returns (bool)",
  "function vrfCoordinator() view returns (address)",
  "function vrfSubscriptionId() view returns (uint256)",
  "function vrfKeyHash() view returns (bytes32)",
  "function vrfCallbackGasLimit() view returns (uint32)",
  "function vrfRequestConfirmations() view returns (uint16)",
  "function vrfNativePayment() view returns (bool)",
  "function pendingWithdrawals(address) view returns (uint256)",
  "function getTable(bytes32) view returns (tuple(bool exists,address player1,address player2,uint256 stake,uint256 pot,uint8 stage,address turn,uint256 actionDeadline,uint256 currentBet,uint8 actionsThisStage,bool confirmed1,bool confirmed2,uint256 handId,uint256 streetAnte,bool streetAntePaid1,bool streetAntePaid2,address winner,bool refunded))",
  "function getHandSeed(bytes32,uint256) view returns (tuple(bytes32 commit1,bytes32 commit2,string secret1,string secret2,bool revealed1,bool revealed2,bytes32 seed,bool ready,uint256 vrfRequestId,uint256 vrfWord,bool vrfReady))"
];

const DEFAULT_RPC = "https://sepolia.base.org";
const BASE_SEPOLIA_CHAIN_ID = 84532;
const EXPECTED_DEVELOPER_FEE_BPS = 200n;
const EXPECTED_TIMEOUT = 60n;

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
    "joinTable(bytes32)",
    "confirm(bytes32)",
    "commitSeed(bytes32,uint256,bytes32)",
    "revealSeed(bytes32,uint256,string)",
    "requestVrfSeed(bytes32,uint256)",
    "rawFulfillRandomWords(uint256,uint256[])",
    "timeoutReveal(bytes32,uint256)",
    "payStreetAnte(bytes32)",
    "check(bytes32)",
    "bet(bytes32)",
    "call(bytes32)",
    "fold(bytes32)",
    "timeout(bytes32)",
    "submitResult(bytes32,address)",
    "resolveDispute(bytes32,address)",
    "claimWinnings()",
    "getTable(bytes32)",
    "pendingWithdrawals(address)",
    "defaultStake()",
    "defaultStreetAnte()",
    "vrfConfigured()",
    "setVrfConfig(address,uint256,bytes32,uint32,uint16,bool)",
    "pause()",
    "unpause()"
  ];

  const requiredEvents = [
    "TableCreated(bytes32,address,uint256)",
    "PlayerJoined(bytes32,address,uint8,uint256)",
    "PlayerConfirmed(bytes32,address)",
    "SeedCommitted(bytes32,uint256,address,bytes32)",
    "SeedRevealed(bytes32,uint256,address,string)",
    "HandSeedReady(bytes32,uint256,bytes32)",
    "VrfSeedRequested(bytes32,uint256,uint256)",
    "VrfSeedFulfilled(bytes32,uint256,uint256,uint256)",
    "StageChanged(bytes32,uint8,address,uint256)",
    "ActionSubmitted(bytes32,address,string,uint256)",
    "PlayerTimedOut(bytes32,address,address)",
    "PlayerFolded(bytes32,address,address)",
    "HandFinished(bytes32,address,uint256,uint256)",
    "WinningsClaimed(address,uint256)"
  ];

  console.log("");
  console.log("Required function selectors:");
  const selectorResults = requiredSelectors.map((signature) => {
    const selector = ethers.id(signature).slice(2, 10);
    const found = code.includes(selector);
    statusLine(signature, found, `0x${selector}`);
    return { signature, found };
  });

  console.log("");
  console.log("Required event topics:");
  const eventResults = requiredEvents.map((signature) => {
    const topic = ethers.id(signature).slice(2);
    const found = code.includes(topic);
    statusLine(signature, found, `0x${topic.slice(0, 8)}...${topic.slice(-8)}`);
    return { signature, found };
  });

  const table = new ethers.Contract(contractAddress, ABI, provider);
  const owner = await table.owner();
  const feeRecipient = await table.feeRecipient();
  const paused = await table.paused();
  const defaultStake = await table.defaultStake();
  const defaultStreetAnte = await table.defaultStreetAnte();
  const timeout = await table.ACTION_TIMEOUT();
  const vrfTimeout = await table.VRF_TIMEOUT();
  const feeBps = await table.DEVELOPER_FEE_BPS();
  const vrfConfigured = await table.vrfConfigured();
  const vrfCoordinator = await table.vrfCoordinator();
  const vrfSubscriptionId = await table.vrfSubscriptionId();
  const vrfKeyHash = await table.vrfKeyHash();
  const vrfCallbackGasLimit = await table.vrfCallbackGasLimit();
  const vrfRequestConfirmations = await table.vrfRequestConfirmations();
  const vrfNativePayment = await table.vrfNativePayment();
  const zeroTableResult = await table.getTable(ethers.ZeroHash);
  const zeroTable = zeroTableResult.exists === undefined && zeroTableResult[0] ? zeroTableResult[0] : zeroTableResult;

  console.log("");
  console.log("Poker Clash escrow:", contractAddress);
  console.log("Owner:", owner);
  console.log("Fee recipient:", feeRecipient);
  console.log("Paused:", paused);
  console.log("Default stake:", ethers.formatEther(defaultStake), "ETH");
  console.log("Default street ante:", ethers.formatEther(defaultStreetAnte), "ETH");
  console.log("Timeout seconds:", timeout.toString());
  console.log("VRF timeout seconds:", vrfTimeout.toString());
  console.log("Developer fee bps:", feeBps.toString());
  console.log("VRF configured:", vrfConfigured);
  console.log("VRF coordinator:", vrfCoordinator);
  console.log("VRF subscription:", vrfSubscriptionId.toString());
  console.log("VRF key hash:", vrfKeyHash);
  console.log("VRF callback gas:", String(vrfCallbackGasLimit));
  console.log("VRF confirmations:", String(vrfRequestConfirmations));
  console.log("VRF native payment:", vrfNativePayment);
  console.log("Zero table exists:", zeroTable.exists);
  console.log("");

  statusLine("public/config.js address", sameAddress(contractAddress, publicAddress), publicAddress || "not set");
  statusLine("developer fee is 2%", BigInt(feeBps) === EXPECTED_DEVELOPER_FEE_BPS, feeBps.toString());
  statusLine("action timeout is 60 seconds", BigInt(timeout) === EXPECTED_TIMEOUT, timeout.toString());
  statusLine("default stake is set", BigInt(defaultStake) > 0n, defaultStake.toString());
  statusLine("default street ante is set", BigInt(defaultStreetAnte) > 0n, defaultStreetAnte.toString());
  statusLine("Chainlink VRF configured", vrfConfigured, vrfCoordinator);

  if (
    selectorResults.some((item) => !item.found) ||
    eventResults.some((item) => !item.found) ||
    BigInt(feeBps) !== EXPECTED_DEVELOPER_FEE_BPS ||
    BigInt(timeout) !== EXPECTED_TIMEOUT ||
    BigInt(defaultStake) <= 0n ||
    BigInt(defaultStreetAnte) <= 0n ||
    !vrfConfigured
  ) {
    throw new Error("Poker Clash escrow check failed. Confirm this address was deployed from contracts/Escrow.sol");
  }

  console.log("");
  console.log("Poker Clash escrow check passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
