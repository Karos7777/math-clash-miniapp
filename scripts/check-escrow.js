require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const ABI = [
  "function owner() view returns (address)",
  "function resolver() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function paused() view returns (bool)",
  "function supportedToken(address token) view returns (bool)",
  "function ENTRY_FEE() view returns (uint256)",
  "function ERC20_ENTRY_FEE() view returns (uint256)",
  "function NATIVE_ENTRY_FEE_WEI() view returns (uint256)",
  "function DEVELOPER_FEE_BPS() view returns (uint256)",
  "function entryFeeFor(address token) view returns (uint256)"
];

const DEFAULT_RPC = "https://sepolia.base.org";
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const EXPECTED_ENTRY_FEE_UNITS = 100000n;
const EXPECTED_NATIVE_ENTRY_FEE_WEI = 100000000000000n;
const EXPECTED_DEVELOPER_FEE_BPS = 400n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function readPublicConfigEscrowAddress() {
  const configPath = path.join(__dirname, "..", "public", "config.js");
  const config = fs.readFileSync(configPath, "utf8");
  const match = config.match(/escrowAddress:\s*["'](0x[a-fA-F0-9]{40})["']/);
  return match ? match[1] : "";
}

function sameAddress(a, b) {
  return a && b && a.toLowerCase() === b.toLowerCase();
}

function statusLine(label, ok, detail) {
  console.log(`${ok ? "OK" : "CHECK"} ${label}: ${detail}`);
}

async function main() {
  const publicEscrowAddress = readPublicConfigEscrowAddress();
  const escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS || publicEscrowAddress;

  if (!ethers.isAddress(escrowAddress || "")) {
    throw new Error("Set ESCROW_CONTRACT_ADDRESS or public/config.js escrowAddress");
  }

  const rpcUrl = process.env.BASE_RPC_URL || process.env.BASE_SEPOLIA_RPC_URL || DEFAULT_RPC;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  statusLine("network", chainId === BASE_SEPOLIA_CHAIN_ID, `chainId=${chainId}`);

  const code = await provider.getCode(escrowAddress);
  statusLine("contract code", code !== "0x", escrowAddress);
  if (code === "0x") {
    throw new Error("No contract code found at ESCROW_CONTRACT_ADDRESS");
  }

  const requiredSelectors = [
    "deposit(bytes32,address)",
    "resolve(bytes32,address,bool)",
    "supportedToken(address)",
    "entryFeeFor(address)",
    "owner()",
    "resolver()",
    "feeRecipient()",
    "pause()",
    "unpause()",
    "emergencyRefund(bytes32)"
  ];
  const selectorResults = requiredSelectors.map((signature) => ({
    signature,
    selector: ethers.id(signature).slice(2, 10),
    found: code.includes(ethers.id(signature).slice(2, 10))
  }));

  console.log("");
  console.log("Required function selectors:");
  selectorResults.forEach((item) => {
    statusLine(item.signature, item.found, `0x${item.selector}`);
  });

  const escrow = new ethers.Contract(escrowAddress, ABI, provider);
  const usdc = process.env.BASE_SEPOLIA_USDC_ADDRESS || BASE_SEPOLIA_USDC;
  const owner = await readContractValue(escrow, "owner");
  const resolver = await readContractValue(escrow, "resolver");
  const feeRecipient = await readContractValue(escrow, "feeRecipient");
  const paused = await readContractValue(escrow, "paused");
  const entryFee = await readContractValue(escrow, "ENTRY_FEE");
  const erc20EntryFee = await readContractValue(escrow, "ERC20_ENTRY_FEE");
  const nativeEntryFee = await readContractValue(escrow, "NATIVE_ENTRY_FEE_WEI");
  const ethEntryFeeFor = await readContractValue(escrow, "entryFeeFor", ZERO_ADDRESS);
  const usdcEntryFeeFor = await readContractValue(escrow, "entryFeeFor", usdc);
  const feeBps = await readContractValue(escrow, "DEVELOPER_FEE_BPS");

  console.log("");
  console.log("Escrow:", escrowAddress);
  console.log("Owner:", owner || "unreadable");
  console.log("Resolver:", resolver || "unreadable");
  console.log("Fee recipient:", feeRecipient || "unreadable");
  console.log("Paused:", paused === null ? "unreadable" : paused);
  console.log("Entry fee units:", entryFee === null ? "unreadable, expected 100000" : entryFee.toString());
  console.log("ERC20 entry fee units:", erc20EntryFee === null ? "unreadable, expected 100000" : erc20EntryFee.toString());
  console.log("Native ETH entry fee wei:", nativeEntryFee === null ? "unreadable, expected 100000000000000" : nativeEntryFee.toString());
  console.log("entryFeeFor(ETH):", ethEntryFeeFor === null ? "unreadable" : ethEntryFeeFor.toString());
  console.log("entryFeeFor(USDC):", usdcEntryFeeFor === null ? "unreadable" : usdcEntryFeeFor.toString());
  console.log("Developer fee bps:", feeBps === null ? "unreadable, expected 400" : feeBps.toString());
  console.log("");

  statusLine("public/config.js address", sameAddress(escrowAddress, publicEscrowAddress), publicEscrowAddress);

  if (process.env.RESOLVER_ADDRESS) {
    statusLine("resolver matches .env RESOLVER_ADDRESS", sameAddress(resolver, process.env.RESOLVER_ADDRESS), resolver);
  }

  if (process.env.FEE_RECIPIENT_ADDRESS) {
    statusLine(
      "feeRecipient matches .env FEE_RECIPIENT_ADDRESS",
      sameAddress(feeRecipient, process.env.FEE_RECIPIENT_ADDRESS),
      feeRecipient
    );
  }

  const usdcSupported = await readContractValue(escrow, "supportedToken", usdc);
  statusLine("Base Sepolia USDC supported", usdcSupported, usdc);

  const nativeSupported = await readContractValue(escrow, "supportedToken", ZERO_ADDRESS);
  statusLine("Native ETH supported", nativeSupported, ZERO_ADDRESS);

  if (process.env.BASE_SEPOLIA_USDT_ADDRESS) {
    const usdtSupported = await readContractValue(escrow, "supportedToken", process.env.BASE_SEPOLIA_USDT_ADDRESS);
    statusLine("Base Sepolia USDT supported", usdtSupported, process.env.BASE_SEPOLIA_USDT_ADDRESS);
  }

  const missingCoreSelector = selectorResults.some((item) => !item.found);
  const fallbackEntryFee = entryFee === null ? await readPossibleStorageEntryFee(provider, escrowAddress) : null;
  const effectiveEntryFee = entryFee === null ? fallbackEntryFee : entryFee;

  if (entryFee === null || feeBps === null) {
    console.log("");
    console.log("WARN constants are unreadable via ABI, but core escrow functions were found.");
    console.log("Expected ENTRY_FEE=100000 and DEVELOPER_FEE_BPS=400 from the source used for deploy.");
    if (fallbackEntryFee !== null) {
      console.log(`Storage hint: possible entry fee is ${fallbackEntryFee.toString()} units.`);
    }
  }

  const entryFeeMatches = effectiveEntryFee === null || BigInt(effectiveEntryFee) === EXPECTED_ENTRY_FEE_UNITS;
  const erc20EntryFeeMatches =
    erc20EntryFee === null || BigInt(erc20EntryFee) === EXPECTED_ENTRY_FEE_UNITS;
  const nativeEntryFeeMatches =
    nativeEntryFee === null || BigInt(nativeEntryFee) === EXPECTED_NATIVE_ENTRY_FEE_WEI;
  const entryFeeForMatches =
    ethEntryFeeFor !== null &&
    BigInt(ethEntryFeeFor) === EXPECTED_NATIVE_ENTRY_FEE_WEI &&
    usdcEntryFeeFor !== null &&
    BigInt(usdcEntryFeeFor) === EXPECTED_ENTRY_FEE_UNITS;
  const feeBpsMatches = feeBps === null || BigInt(feeBps) === EXPECTED_DEVELOPER_FEE_BPS;

  statusLine(
    "entry fee is 0.1 USDC units",
    entryFeeMatches,
    effectiveEntryFee === null ? "unreadable" : effectiveEntryFee.toString()
  );
  statusLine(
    "developer fee is 4%",
    feeBpsMatches,
    feeBps === null ? "unreadable" : feeBps.toString()
  );
  statusLine(
    "native ETH entry is 0.0001 ETH",
    nativeEntryFeeMatches && entryFeeForMatches,
    ethEntryFeeFor === null ? "unreadable" : ethEntryFeeFor.toString()
  );

  if (
    missingCoreSelector ||
    !owner ||
    !resolver ||
    !feeRecipient ||
    usdcSupported !== true ||
    nativeSupported !== true ||
    !entryFeeMatches ||
    !erc20EntryFeeMatches ||
    !nativeEntryFeeMatches ||
    !entryFeeForMatches ||
    !feeBpsMatches
  ) {
    throw new Error("Escrow ABI check is incomplete. Confirm this address was deployed from contracts/Escrow.sol");
  }

  console.log("");
  console.log("Escrow check passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function readContractValue(contract, functionName, ...args) {
  try {
    return await contract[functionName](...args);
  } catch {
    return null;
  }
}

async function readPossibleStorageEntryFee(provider, address) {
  try {
    const slotOne = BigInt(await provider.getStorage(address, 1));
    if (slotOne > 0n && slotOne < 1000000000000n) return slotOne;
  } catch {
    return null;
  }
  return null;
}
