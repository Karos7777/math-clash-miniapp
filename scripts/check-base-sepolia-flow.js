require("dotenv").config();

const hre = require("hardhat");

let contractInterface;
let contractAddress;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`OK ${message}`);
}

async function expectEvent(txPromise, eventName) {
  const tx = await txPromise;
  console.log(`TX ${eventName}: ${tx.hash}`);
  const receipt = await tx.wait();
  const found = receipt.logs.some((log) => {
    try {
      const parsed = contractInterface.parseLog(log);
      return parsed?.name === eventName;
    } catch {
      return false;
    }
  });
  assert(found, `${eventName} emitted on Base Sepolia`);
  return receipt;
}

async function expectEvents(txPromises, eventNames) {
  const txs = await Promise.all(txPromises);
  txs.forEach((tx, index) => {
    console.log(`TX parallel ${index + 1}: ${tx.hash}`);
  });
  const receipts = await Promise.all(txs.map((tx) => tx.wait()));
  for (const eventName of eventNames) {
    const found = receipts.some((receipt) => receipt.logs.some((log) => {
      try {
        const parsed = contractInterface.parseLog(log);
        return parsed?.name === eventName;
      } catch {
        return false;
      }
    }));
    assert(found, `${eventName} emitted on Base Sepolia`);
  }
  return receipts;
}

async function contractTx(signer, functionName, args = [], overrides = {}) {
  try {
    return await signer.sendTransaction({
      to: contractAddress,
      data: contractInterface.encodeFunctionData(functionName, args),
      gasLimit: 500000n,
      ...overrides
    });
  } catch (error) {
    const rawTx = error?.payload?.params?.[0];
    if (String(error?.error?.message || error?.message || "").includes("already known") && rawTx) {
      const hash = hre.ethers.keccak256(rawTx);
      return {
        hash,
        wait: () => signer.provider.waitForTransaction(hash)
      };
    }
    throw error;
  }
}

async function waitFor(description, read, predicate, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error(`${description} did not become ready`);
}

async function main() {
  contractAddress = process.env.GAME_CONTRACT_ADDRESS || process.env.ESCROW_CONTRACT_ADDRESS || "";
  if (!hre.ethers.isAddress(contractAddress)) {
    throw new Error("Set GAME_CONTRACT_ADDRESS to the deployed Base Sepolia contract");
  }

  const provider = new hre.ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org");
  const chainId = Number((await provider.getNetwork()).chainId);
  if (chainId !== 84532) {
    throw new Error(`Expected Base Sepolia 84532, got ${chainId}`);
  }

  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error("Set DEPLOYER_PRIVATE_KEY; it is used as player1 for this testnet audit");
  }
  const player1 = new hre.ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  let player2;
  let generatedPlayer2 = false;
  if (process.env.PLAYER2_PRIVATE_KEY) {
    player2 = new hre.ethers.Wallet(process.env.PLAYER2_PRIVATE_KEY, provider);
  } else {
    player2 = hre.ethers.Wallet.createRandom().connect(provider);
    generatedPlayer2 = true;
    const fundAmount = hre.ethers.parseEther("0.00018");
    const balance = await provider.getBalance(player1.address);
    if (balance < fundAmount + hre.ethers.parseEther("0.00024")) {
      throw new Error("Player1 has too little Base Sepolia ETH to fund a temporary player2 wallet");
    }
    const fundTx = await player1.sendTransaction({ to: player2.address, value: fundAmount });
    console.log(`TX fund temporary player2: ${fundTx.hash}`);
    await fundTx.wait();
  }

  const artifact = await hre.artifacts.readArtifact("Escrow");
  contractInterface = new hre.ethers.Interface(artifact.abi);
  const escrow = new hre.ethers.Contract(contractAddress, artifact.abi, provider);

  const stake = await escrow.defaultStake();
  const streetAnte = await escrow.defaultStreetAnte();
  const tableId = hre.ethers.keccak256(
    hre.ethers.solidityPacked(["string", "address", "address", "uint256"], ["base-sepolia-audit", player1.address, player2.address, Date.now()])
  );

  console.log("Contract:", contractAddress);
  console.log("Player1:", player1.address);
  console.log("Player2:", player2.address, generatedPlayer2 ? "(temporary funded audit wallet)" : "");
  console.log("Table:", tableId);

  await expectEvent(contractTx(player1, "joinTable", [tableId], { value: stake }), "TableCreated");
  await expectEvent(contractTx(player2, "joinTable", [tableId], { value: stake }), "TableReady");
  await expectEvents(
    [contractTx(player1, "confirm", [tableId]), contractTx(player2, "confirm", [tableId])],
    ["PlayerConfirmed", "StageChanged"]
  );

  const secret1 = `audit-secret-1-${Date.now()}`;
  const secret2 = `audit-secret-2-${Date.now()}`;
  const commit1 = hre.ethers.keccak256(
    hre.ethers.solidityPacked(["string", "address", "bytes32", "uint256"], [secret1, player1.address, tableId, 1n])
  );
  const commit2 = hre.ethers.keccak256(
    hre.ethers.solidityPacked(["string", "address", "bytes32", "uint256"], [secret2, player2.address, tableId, 1n])
  );

  await expectEvents(
    [
      contractTx(player1, "commitSeed", [tableId, 1n, commit1]),
      contractTx(player2, "commitSeed", [tableId, 1n, commit2])
    ],
    ["SeedCommitted", "StageChanged"]
  );
  await expectEvent(contractTx(player1, "revealSeed", [tableId, 1n, secret1]), "SeedRevealed");
  await expectEvent(contractTx(player2, "revealSeed", [tableId, 1n, secret2], { gasLimit: 800000n }), "VrfSeedRequested");

  const hand = await waitFor(
    "Chainlink VRF hand seed",
    () => escrow.getHandSeed(tableId, 1n),
    (value) => value.ready && value.vrfReady && value.seed !== hre.ethers.ZeroHash,
    60
  );
  assert(hand.ready, "Base Sepolia seed ready");
  assert(hand.vrfReady, "Base Sepolia VRF word ready");
  assert(hand.seed !== hre.ethers.ZeroHash, "Base Sepolia seed nonzero");

  await expectEvents(
    [
      contractTx(player1, "payStreetAnte", [tableId], { value: streetAnte }),
      contractTx(player2, "payStreetAnte", [tableId], { value: streetAnte })
    ],
    ["StreetAntePaid", "StageChanged"]
  );

  for (const stageName of ["preflop", "flop", "turn", "river"]) {
    await expectEvent(contractTx(player1, "check", [tableId]), "ActionSubmitted");
    if (stageName !== "river") {
      await expectEvent(contractTx(player2, "check", [tableId]), "StageChanged");
      await expectEvents(
        [
          contractTx(player1, "payStreetAnte", [tableId], { value: streetAnte }),
          contractTx(player2, "payStreetAnte", [tableId], { value: streetAnte })
        ],
        ["StreetAntePaid", "StageChanged"]
      );
    } else {
      await expectEvent(contractTx(player2, "check", [tableId]), "StageChanged");
    }
  }

  await expectEvent(contractTx(player1, "submitResult", [tableId, player1.address]), "ResultSubmitted");
  await expectEvent(contractTx(player2, "submitResult", [tableId, player1.address]), "HandFinished");
  const pending = await escrow.pendingWithdrawals(player1.address);
  assert(pending > 0n, "Base Sepolia winner has pending payout");
  await expectEvent(contractTx(player1, "claimWinnings"), "WinningsClaimed");

  console.log("");
  console.log("Base Sepolia poker flow check passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
