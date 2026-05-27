require("dotenv").config();

const { ethers } = require("ethers");

const ABI = [
  "function owner() view returns (address)",
  "function resolver() view returns (address)",
  "function setResolver(address newResolver) external"
];

const DEFAULT_RPC = "https://sepolia.base.org";

function maskAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function requirePrivateKey(value, envName) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value || "")) {
    throw new Error(`${envName} must be a full private key: 0x + 64 hex chars`);
  }
}

function getDesiredResolver() {
  const explicitAddress = process.env.RESOLVER_ADDRESS || "";
  if (explicitAddress) {
    if (!ethers.isAddress(explicitAddress)) {
      throw new Error("RESOLVER_ADDRESS must be a valid wallet address");
    }
    return ethers.getAddress(explicitAddress);
  }

  const resolverPrivateKey = process.env.ESCROW_RESOLVER_PRIVATE_KEY || "";
  requirePrivateKey(resolverPrivateKey, "ESCROW_RESOLVER_PRIVATE_KEY");
  return new ethers.Wallet(resolverPrivateKey).address;
}

async function main() {
  const escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS || "";
  const ownerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY || "";
  const rpcUrl = process.env.BASE_RPC_URL || process.env.BASE_SEPOLIA_RPC_URL || DEFAULT_RPC;

  if (!ethers.isAddress(escrowAddress)) {
    throw new Error("ESCROW_CONTRACT_ADDRESS must be set to the deployed escrow address");
  }
  requirePrivateKey(ownerPrivateKey, "DEPLOYER_PRIVATE_KEY");

  const desiredResolver = getDesiredResolver();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  const escrow = new ethers.Contract(escrowAddress, ABI, ownerWallet);

  const [contractOwner, currentResolver] = await Promise.all([escrow.owner(), escrow.resolver()]);

  console.log(`Escrow: ${escrowAddress}`);
  console.log(`Contract owner: ${maskAddress(contractOwner)}`);
  console.log(`Signer wallet: ${maskAddress(ownerWallet.address)}`);
  console.log(`Current resolver: ${maskAddress(currentResolver)}`);
  console.log(`Desired resolver: ${maskAddress(desiredResolver)}`);

  if (ownerWallet.address.toLowerCase() !== contractOwner.toLowerCase()) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not the contract owner, so it cannot call setResolver()");
  }

  if (currentResolver.toLowerCase() === desiredResolver.toLowerCase()) {
    console.log("");
    console.log("Resolver already matches. Nothing to update.");
    return;
  }

  const tx = await escrow.setResolver(desiredResolver);
  console.log("");
  console.log(`setResolver submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`setResolver confirmed in block ${receipt.blockNumber}`);

  const updatedResolver = await escrow.resolver();
  console.log(`Updated resolver: ${maskAddress(updatedResolver)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
