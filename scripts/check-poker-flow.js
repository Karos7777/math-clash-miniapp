const hre = require("hardhat");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`OK ${message}`);
}

async function expectEvent(txPromise, eventName) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  const found = receipt.logs.some((log) => {
    try {
      const parsed = contractInterface.parseLog(log);
      return parsed?.name === eventName;
    } catch {
      return false;
    }
  });
  assert(found, `${eventName} emitted`);
  return receipt;
}

let contractInterface;

async function main() {
  const [owner, player1, player2] = await hre.ethers.getSigners();
  const stake = hre.ethers.parseEther("0.0001");
  const streetAnte = stake / 10n;
  const tableId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("audit-table"));
  const keyHash = `0x${"9e".repeat(32)}`;

  const MockVrf = await hre.ethers.getContractFactory("MockVrfCoordinator");
  const mockVrf = await MockVrf.deploy();
  await mockVrf.waitForDeployment();
  const Escrow = await hre.ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(owner.address, stake, await mockVrf.getAddress(), 1n, keyHash, 300000, 3, true);
  await escrow.waitForDeployment();
  contractInterface = escrow.interface;

  await expectEvent(escrow.connect(player1).joinTable(tableId, { value: stake }), "TableCreated");
  await expectEvent(escrow.connect(player2).joinTable(tableId, { value: stake }), "TableReady");

  await expectEvent(escrow.connect(player1).confirm(tableId), "PlayerConfirmed");
  await expectEvent(escrow.connect(player2).confirm(tableId), "StageChanged");

  let table = await escrow.getTable(tableId);
  assert(Number(table.stage) === 2, "stage is waiting_for_commit");
  assert(table.handId === 1n, "hand id started");

  const secret1 = "audit-secret-player-1";
  const secret2 = "audit-secret-player-2";
  const commit1 = hre.ethers.keccak256(
    hre.ethers.solidityPacked(["string", "address", "bytes32", "uint256"], [secret1, player1.address, tableId, 1n])
  );
  const commit2 = hre.ethers.keccak256(
    hre.ethers.solidityPacked(["string", "address", "bytes32", "uint256"], [secret2, player2.address, tableId, 1n])
  );

  await expectEvent(escrow.connect(player1).commitSeed(tableId, 1n, commit1), "SeedCommitted");
  await expectEvent(escrow.connect(player2).commitSeed(tableId, 1n, commit2), "StageChanged");
  table = await escrow.getTable(tableId);
  assert(Number(table.stage) === 3, "stage is waiting_for_reveal");

  await expectEvent(escrow.connect(player1).revealSeed(tableId, 1n, secret1), "SeedRevealed");
  await expectEvent(escrow.connect(player2).revealSeed(tableId, 1n, secret2), "VrfSeedRequested");
  table = await escrow.getTable(tableId);
  assert(Number(table.stage) === 12, "stage is waiting_for_vrf");

  let hand = await escrow.getHandSeed(tableId, 1n);
  assert(hand.vrfRequestId > 0n, "VRF request id recorded");
  await expectEvent(mockVrf.fulfill(hand.vrfRequestId, 123456789n), "HandSeedReady");
  hand = await escrow.getHandSeed(tableId, 1n);
  assert(hand.ready, "hand seed ready");
  assert(hand.vrfReady, "VRF word ready");
  assert(hand.vrfWord === 123456789n, "VRF word stored");
  assert(hand.seed !== hre.ethers.ZeroHash, "seed is nonzero");

  await expectEvent(escrow.connect(player1).payStreetAnte(tableId, { value: streetAnte }), "StreetAntePaid");
  await expectEvent(escrow.connect(player2).payStreetAnte(tableId, { value: streetAnte }), "StageChanged");
  table = await escrow.getTable(tableId);
  assert(Number(table.stage) === 6, "preflop starts after both antes");
  assert(table.turn === player1.address, "player1 acts first");

  for (const stageName of ["preflop", "flop", "turn", "river"]) {
    await expectEvent(escrow.connect(player1).check(tableId), "ActionSubmitted");
    if (stageName !== "river") {
      await expectEvent(escrow.connect(player2).check(tableId), "StageChanged");
      await expectEvent(escrow.connect(player1).payStreetAnte(tableId, { value: streetAnte }), "StreetAntePaid");
      await expectEvent(escrow.connect(player2).payStreetAnte(tableId, { value: streetAnte }), "StageChanged");
    } else {
      await expectEvent(escrow.connect(player2).check(tableId), "StageChanged");
    }
  }

  table = await escrow.getTable(tableId);
  assert(Number(table.stage) === 10, "showdown reached");

  await expectEvent(escrow.connect(player1).submitResult(tableId, player1.address), "ResultSubmitted");
  await expectEvent(escrow.connect(player2).submitResult(tableId, player1.address), "HandFinished");
  table = await escrow.getTable(tableId);
  assert(Number(table.stage) === 11, "hand finished");

  const pending = await escrow.pendingWithdrawals(player1.address);
  assert(pending > 0n, "winner has pending payout");
  await expectEvent(escrow.connect(player1).claimWinnings(), "WinningsClaimed");
  assert((await escrow.pendingWithdrawals(player1.address)) === 0n, "winner claimed payout");

  console.log("");
  console.log("Poker contract flow check passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
