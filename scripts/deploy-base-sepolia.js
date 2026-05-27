const hre = require("hardhat");

const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function requireAddress(name) {
  const value = process.env[name];
  if (!hre.ethers.isAddress(value || "")) {
    throw new Error(`${name} must be set to a valid address`);
  }
  return value;
}

function optionalAddress(name) {
  const value = process.env[name];
  if (!value) return null;
  if (!hre.ethers.isAddress(value)) {
    throw new Error(`${name} must be a valid address when provided`);
  }
  return value;
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

  const resolver = requireAddress("RESOLVER_ADDRESS");
  const feeRecipient = requireAddress("FEE_RECIPIENT_ADDRESS");
  const usdc = optionalAddress("BASE_SEPOLIA_USDC_ADDRESS") || BASE_SEPOLIA_USDC;
  const usdt = optionalAddress("BASE_SEPOLIA_USDT_ADDRESS");
  const tokens = [usdc, usdt].filter(Boolean);

  console.log("Network: Base Sepolia");
  console.log("Deployer:", deployer.address);
  console.log("Resolver:", resolver);
  console.log("Fee recipient:", feeRecipient);
  console.log("Native ETH entry:", "0.0001 ETH");
  console.log("Supported tokens:", tokens.join(", "));

  const Escrow = await hre.ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(resolver, feeRecipient, tokens);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log("");
  console.log("Escrow deployed:", address);
  console.log("Explorer:", `https://sepolia-explorer.base.org/address/${address}`);
  console.log("");
  console.log("Copy this into public/config.js:");
  console.log(`escrowAddress: "${address}",`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
