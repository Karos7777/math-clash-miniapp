const hre = require("hardhat");

const BASE_SEPOLIA_CHAIN_ID = 84532;

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

  console.log("Network: Base Sepolia");
  console.log("Deployer:", deployer.address);
  console.log("Fee recipient:", feeRecipient);
  console.log("Default stake:", hre.ethers.formatEther(defaultStake), "ETH");
  console.log("Default street ante:", hre.ethers.formatEther(defaultStake / 10n || 1n), "ETH");
  console.log("Action timeout:", "60 seconds");
  console.log("Fee:", "2%");
  console.log("Game type: two-player testnet poker MVP with Provably Fair v1");

  const Escrow = await hre.ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(feeRecipient, defaultStake);
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
