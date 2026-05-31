const hre = require("hardhat");

const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_VRF_COORDINATOR = "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE";
const BASE_SEPOLIA_VRF_KEY_HASH = "0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71";

function requireAddress(name, fallback = "") {
  const value = process.env[name] || fallback;
  if (!hre.ethers.isAddress(value || "")) {
    throw new Error(`${name} must be set to a valid address`);
  }
  return value;
}

function parseEthEnv(name, fallback) {
  const value = process.env[name] || fallback;
  try {
    return hre.ethers.parseEther(value);
  } catch {
    throw new Error(`${name} must be an ETH amount, for example 0.0001`);
  }
}

function optionalUint(name, fallback = "0") {
  const value = process.env[name] || fallback;
  if (!/^\d+$/.test(String(value))) {
    throw new Error(`${name} must be an unsigned integer`);
  }
  return BigInt(value);
}

function optionalBytes32(name, fallback) {
  const value = process.env[name] || fallback;
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(value || ""))) {
    throw new Error(`${name} must be a bytes32 value`);
  }
  return value;
}

function boolEnv(name, fallback) {
  const value = String(process.env[name] ?? fallback).toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`Refusing to deploy: expected Base Sepolia ${BASE_SEPOLIA_CHAIN_ID}, got ${chainId}`);
  }

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer signer. Set DEPLOYER_PRIVATE_KEY in .env");
  }

  const feeRecipient = requireAddress("FEE_RECIPIENT_ADDRESS", deployer.address);
  const defaultStake = parseEthEnv("DEFAULT_STAKE_ETH", process.env.LOW_LIMIT_BUY_IN_ETH || "0.0001");
  const vrfCoordinator = requireAddress("VRF_COORDINATOR", BASE_SEPOLIA_VRF_COORDINATOR);
  const vrfSubscriptionId = optionalUint("VRF_SUBSCRIPTION_ID");
  const vrfKeyHash = optionalBytes32("VRF_KEY_HASH", BASE_SEPOLIA_VRF_KEY_HASH);
  const vrfCallbackGasLimit = Number(optionalUint("VRF_CALLBACK_GAS_LIMIT", "300000"));
  const vrfRequestConfirmations = Number(optionalUint("VRF_REQUEST_CONFIRMATIONS", "3"));
  const vrfNativePayment = boolEnv("VRF_NATIVE_PAYMENT", "true");

  if (!vrfSubscriptionId) {
    throw new Error(
      "VRF_SUBSCRIPTION_ID is required. Create/fund a Chainlink VRF v2.5 subscription and add this contract as a consumer after deploy."
    );
  }

  console.log("Network: Base Sepolia");
  console.log("Deployer:", deployer.address);
  console.log("Fee recipient:", feeRecipient);
  console.log("Default stake:", hre.ethers.formatEther(defaultStake), "ETH");
  console.log("Default street ante:", hre.ethers.formatEther(defaultStake / 10n || 1n), "ETH");
  console.log("Action timeout:", "60 seconds");
  console.log("Fee:", "2%");
  console.log("Game type: two-player testnet poker MVP with Chainlink VRF");
  console.log("VRF coordinator:", vrfCoordinator);
  console.log("VRF subscription:", vrfSubscriptionId.toString());
  console.log("VRF key hash:", vrfKeyHash);
  console.log("VRF callback gas:", vrfCallbackGasLimit);
  console.log("VRF confirmations:", vrfRequestConfirmations);
  console.log("VRF native payment:", vrfNativePayment);

  const Escrow = await hre.ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(
    feeRecipient,
    defaultStake,
    vrfCoordinator,
    vrfSubscriptionId,
    vrfKeyHash,
    vrfCallbackGasLimit,
    vrfRequestConfirmations,
    vrfNativePayment
  );
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log("");
  console.log("Poker table deployed:", address);
  console.log("Explorer:", `https://sepolia-explorer.base.org/address/${address}`);
  console.log("");
  console.log("Set this in Cloudflare Pages Environment Variables:");
  console.log(`GAME_CONTRACT_ADDRESS=${address}`);
  console.log("");
  console.log("Or for local public/config.js:");
  console.log(`gameContractAddress: "${address}",`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
