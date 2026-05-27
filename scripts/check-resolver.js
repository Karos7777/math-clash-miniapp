require("dotenv").config();

const { ethers } = require("ethers");

const ABI = ["function resolver() view returns (address)"];
const DEFAULT_RPC = "https://sepolia.base.org";

function maskAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function statusLine(label, ok, detail) {
  console.log(`${ok ? "OK" : "CHECK"} ${label}: ${detail}`);
}

async function main() {
  const privateKey = process.env.ESCROW_RESOLVER_PRIVATE_KEY || "";
  const escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS || "";
  const rpcUrl = process.env.BASE_RPC_URL || process.env.BASE_SEPOLIA_RPC_URL || DEFAULT_RPC;

  const keyLooksValid = /^0x[a-fA-F0-9]{64}$/.test(privateKey);
  statusLine("private key format", keyLooksValid, keyLooksValid ? "0x + 64 hex chars" : "invalid");
  if (!keyLooksValid) {
    throw new Error("ESCROW_RESOLVER_PRIVATE_KEY must be a full private key, not an address or seed phrase");
  }

  if (!ethers.isAddress(escrowAddress)) {
    throw new Error("ESCROW_CONTRACT_ADDRESS must be set to the deployed escrow address");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const escrow = new ethers.Contract(escrowAddress, ABI, provider);
  const resolver = await escrow.resolver();
  const balance = await provider.getBalance(wallet.address);

  statusLine("derived resolver wallet", true, maskAddress(wallet.address));
  statusLine("contract resolver", true, maskAddress(resolver));
  statusLine("wallet matches contract resolver", wallet.address.toLowerCase() === resolver.toLowerCase(), maskAddress(wallet.address));
  statusLine("resolver gas balance", balance > 0n, `${ethers.formatEther(balance)} ETH`);

  if (wallet.address.toLowerCase() !== resolver.toLowerCase()) {
    throw new Error("Resolver private key does not match contract resolver()");
  }

  if (balance === 0n) {
    throw new Error("Resolver wallet needs Base Sepolia ETH for gas");
  }

  console.log("");
  console.log("Resolver check passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
