const CONFIG = {
  appName: "Poker Clash",
  appUrl: window.location.origin,
  gameContractAddress: "",
  escrowAddress: "",
  defaultStakeEth: "0.0001",
  defaultBetEth: "0.00001",
  developerFeeBps: 200,
  chain: {
    id: 84532,
    hex: "0x14a34",
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia-explorer.base.org"
  },
  ...(window.MATH_CLASH_CONFIG || {})
};

const CONTRACT_ADDRESS = CONFIG.gameContractAddress || CONFIG.escrowAddress || "";
const MAX_SEATS = 6;
const TABLE_STATES = [
  "WAITING",
  "HAND_ANTE",
  "HAND_COMMIT",
  "HAND_BET",
  "HAND_REVEAL",
  "HAND_SETTLED",
  "TABLE_CLOSED"
];
const BASE_CHAIN = {
  id: Number(CONFIG.chain?.id || 84532),
  hex: CONFIG.chain?.hex || `0x${Number(CONFIG.chain?.id || 84532).toString(16)}`,
  name: CONFIG.chain?.name || "Base Sepolia",
  rpcUrl: CONFIG.chain?.rpcUrl || "https://sepolia.base.org",
  explorerUrl: CONFIG.chain?.explorerUrl || "https://sepolia-explorer.base.org"
};

const CONTRACT_ABI = [
  "function joinGame() payable",
  "function joinSeat(uint8 seat) payable",
  "function topUpStack() payable",
  "function payAnte() payable",
  "function commitNumber(bytes32 commitHash)",
  "function check()",
  "function bet(uint256 amount) payable",
  "function call() payable",
  "function raiseBet(uint256 amount) payable",
  "function fold()",
  "function reveal(uint8 number, bytes32 salt)",
  "function timeout()",
  "function cashOutStack()",
  "function claimWinnings()",
  "function gameState() view returns (uint8)",
  "function getSeats() view returns (address[6])",
  "function seatCount() view returns (uint8)",
  "function stacks(address) view returns (uint256)",
  "function pendingWithdrawals(address) view returns (uint256)",
  "function handAnte() view returns (uint256)",
  "function minBuyIn() view returns (uint256)",
  "function roundNumber() view returns (uint256)",
  "function roundPot() view returns (uint256)",
  "function currentBet() view returns (uint256)",
  "function currentActorSeat() view returns (uint8)",
  "function timeoutAt() view returns (uint256)",
  "function hasPaidAnte(address) view returns (bool)",
  "function isActiveInHand(address) view returns (bool)",
  "function hasCommitted(address) view returns (bool)",
  "function hasRevealed(address) view returns (bool)",
  "function hasFolded(address) view returns (bool)",
  "function handContribution(address) view returns (uint256)",
  "function revealedNumbers(address) view returns (uint8)",
  "function DEVELOPER_FEE_BPS() view returns (uint256)",
  "event PlayerJoined(address indexed player, uint8 indexed seat, uint256 buyIn)",
  "event HandStarted(uint256 indexed handNumber, uint256 handPot)",
  "event AntePaid(address indexed player, uint256 amount, uint8 activePlayers)",
  "event PlayerBet(address indexed player, uint256 amount)",
  "event PlayerCalled(address indexed player, uint256 amount)",
  "event PlayerRaised(address indexed player, uint256 amount, uint256 newCurrentBet)",
  "event PlayerFolded(address indexed player)",
  "event PlayerChecked(address indexed player)",
  "event HandSettled(uint256 indexed handNumber, address indexed winner, uint256 grossPot, uint256 playerPayout, uint256 developerFee)",
  "event PayoutSent(address indexed to, uint256 amount)",
  "event PayoutCredited(address indexed to, uint256 amount)",
  "event StacksUpdated(address[6] seats, uint256[6] stacks)"
];

const state = {
  sdk: null,
  provider: null,
  ethers: null,
  account: "",
  readContract: null,
  writeContract: null,
  tableSelected: localStorage.getItem("poker-clash:selected-table") === "low-6max",
  selectedSeat: normalizeSeatIndex(localStorage.getItem("poker-clash:selected-seat")),
  table: null,
  busy: false,
  pollId: null,
  chatPollId: null,
  eventsAttached: false,
  history: []
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  chooseTableButton: $("#chooseTableButton"),
  saveMiniApp: $("#saveMiniApp"),
  shareMiniApp: $("#shareMiniApp"),
  connectWallet: $("#connectWallet"),
  phaseLabel: $("#phaseLabel"),
  roundPot: $("#roundPot"),
  potMark: $("#potMark"),
  timeoutLabel: $("#timeoutLabel"),
  statusLine: $("#statusLine"),
  actionTitle: $("#actionTitle"),
  stakeInput: $("#stakeInput"),
  joinButton: $("#joinButton"),
  topUpButton: $("#topUpButton"),
  payAnteButton: $("#payAnteButton"),
  numberSelect: $("#numberSelect"),
  commitButton: $("#commitButton"),
  betInput: $("#betInput"),
  betButton: $("#betButton"),
  checkButton: $("#checkButton"),
  callButton: $("#callButton"),
  raiseButton: $("#raiseButton"),
  foldButton: $("#foldButton"),
  revealButton: $("#revealButton"),
  timeoutButton: $("#timeoutButton"),
  cashOutButton: $("#cashOutButton"),
  claimButton: $("#claimButton"),
  refreshButton: $("#refreshButton"),
  seatGrid: $("#seatGrid"),
  player1Name: $("#player1Name"),
  player2Name: $("#player2Name"),
  player1Stack: $("#player1Stack"),
  player2Stack: $("#player2Stack"),
  contractAddress: $("#contractAddress"),
  currentBet: $("#currentBet"),
  commitInfo: $("#commitInfo"),
  pendingWithdrawal: $("#pendingWithdrawal"),
  roundNumber: $("#roundNumber"),
  maxRounds: $("#maxRounds"),
  roundAnte: $("#roundAnte"),
  feeBps: $("#feeBps"),
  stackChart: $("#stackChart"),
  eventLog: $("#eventLog"),
  lobbyLastChat: $("#lobbyLastChat"),
  tableLastChat: $("#tableLastChat"),
  lobbyChatForm: $("#lobbyChatForm"),
  tableChatForm: $("#tableChatForm"),
  lobbyChatInput: $("#lobbyChatInput"),
  tableChatInput: $("#tableChatInput")
};
elements.stakeField = elements.stakeInput.closest("label");
elements.numberField = elements.numberSelect.closest("label");
elements.betField = elements.betInput.closest("label");

boot().catch(showFatalError);

async function boot() {
  elements.stakeInput.value = CONFIG.defaultStakeEth || "0.0001";
  elements.betInput.value = CONFIG.defaultBetEth || "0.00001";
  renderNumberOptions();
  bindEvents();
  renderTableChoice();
  initMiniApp().catch((error) => console.info("Mini App init skipped:", error.message));
  await initReadContract();
  await refreshTable();
  await refreshChats();
  startPolling();
}

function bindEvents() {
  elements.chooseTableButton.addEventListener("click", chooseTable);
  elements.connectWallet.addEventListener("click", connectWallet);
  elements.saveMiniApp.addEventListener("click", saveMiniApp);
  elements.shareMiniApp.addEventListener("click", shareMiniApp);
  elements.refreshButton.addEventListener("click", refreshTable);
  elements.joinButton.addEventListener("click", findTable);
  elements.topUpButton.addEventListener("click", topUpStack);
  elements.payAnteButton.addEventListener("click", payAnte);
  elements.commitButton.addEventListener("click", commitNumber);
  elements.betButton.addEventListener("click", bet);
  elements.checkButton.addEventListener("click", () => sendAction("check", "Checking..."));
  elements.callButton.addEventListener("click", callBet);
  elements.raiseButton.addEventListener("click", raiseBet);
  elements.foldButton.addEventListener("click", () => sendAction("fold", "Folding hand..."));
  elements.revealButton.addEventListener("click", reveal);
  elements.timeoutButton.addEventListener("click", () => sendAction("timeout", "Claiming timeout..."));
  elements.cashOutButton.addEventListener("click", () => sendAction("cashOutStack", "Cashing out table stack..."));
  elements.claimButton.addEventListener("click", () => sendAction("claimWinnings", "Claiming fallback payout..."));
  elements.lobbyChatForm.addEventListener("submit", (event) => sendChat(event, "lobby"));
  elements.tableChatForm.addEventListener("submit", (event) => sendChat(event, "table"));
}

function chooseTable() {
  state.tableSelected = true;
  localStorage.setItem("poker-clash:selected-table", "low-6max");
  renderTableChoice();
  setStatus("Low Limit 6-Max table entered. Choose an open seat.");
  if (state.table) renderTable();
  refreshControls();
}

function renderTableChoice() {
  elements.chooseTableButton.textContent = state.tableSelected ? "Low Limit table entered" : "Enter 6-seat table";
}

function renderNumberOptions() {
  elements.numberSelect.innerHTML = "";
  for (let number = 1; number <= 10; number += 1) {
    const option = document.createElement("option");
    option.value = String(number);
    option.textContent = String(number);
    elements.numberSelect.append(option);
  }
}

async function initMiniApp() {
  try {
    const module = await import("https://esm.sh/@farcaster/miniapp-sdk");
    state.sdk = module.sdk;
    await state.sdk.actions.ready();
    refreshMiniAppActions();
  } catch (error) {
    console.info("Farcaster SDK unavailable:", error.message);
  }
}

function refreshMiniAppActions() {
  const actions = state.sdk?.actions || {};
  elements.saveMiniApp.hidden = typeof actions.addMiniApp !== "function";
  elements.shareMiniApp.hidden = typeof actions.composeCast !== "function";
}

async function saveMiniApp() {
  try {
    if (typeof state.sdk?.actions?.addMiniApp !== "function") {
      setStatus("Open in Farcaster to save this Mini App.");
      return;
    }
    await state.sdk.actions.addMiniApp();
    setStatus("Mini App saved.");
  } catch (error) {
    setStatus(error.message || "Could not save Mini App.");
  }
}

async function shareMiniApp() {
  try {
    if (typeof state.sdk?.actions?.composeCast !== "function") {
      setStatus("Open in Farcaster to share this Mini App.");
      return;
    }
    await state.sdk.actions.composeCast({
      text: `I am waiting at the ${CONFIG.appName} low-limit 6-max table.`,
      embeds: [CONFIG.appUrl || window.location.origin]
    });
  } catch (error) {
    setStatus(error.message || "Could not share Mini App.");
  }
}

async function initReadContract() {
  elements.contractAddress.textContent = isAddress(CONTRACT_ADDRESS)
    ? shortAddress(CONTRACT_ADDRESS)
    : "Preview mode";

  if (!isAddress(CONTRACT_ADDRESS)) {
    setStatus("Table preview is open. Real buy-ins turn on after the table contract is connected.");
    refreshControls();
    return;
  }

  const { Contract, JsonRpcProvider } = await getEthers();
  const provider = new JsonRpcProvider(BASE_CHAIN.rpcUrl, BASE_CHAIN.id);
  state.readContract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
  attachContractEvents();
}

async function connectWallet() {
  try {
    state.provider = await getWalletProvider();
    if (!state.provider?.request) {
      setStatus("Open in Farcaster/Base app or a browser with Rabby/Coinbase Wallet.");
      return;
    }

    const accounts = await requestAccounts(state.provider);
    state.account = accounts[0];
    localStorage.setItem("poker-clash:last-wallet", state.account);
    elements.connectWallet.textContent = shortAddress(state.account);

    await ensureBaseChain(state.provider);

    if (isAddress(CONTRACT_ADDRESS)) {
      const { BrowserProvider, Contract } = await getEthers();
      const browserProvider = new BrowserProvider(state.provider);
      const signer = await browserProvider.getSigner();
      state.writeContract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    }

    setStatus("Wallet connected.");
    await refreshTable();
  } catch (error) {
    setStatus(getWalletError(error, "Wallet connection failed."));
  }
}

async function getWalletProvider() {
  if (state.sdk?.wallet?.getEthereumProvider) {
    try {
      const miniAppProvider = await withTimeout(state.sdk.wallet.getEthereumProvider(), 5000);
      if (miniAppProvider?.request) return miniAppProvider;
    } catch (error) {
      console.info("Mini App wallet unavailable:", error.message);
    }
  }

  const candidates = [];
  if (window.rabby) candidates.push(window.rabby);
  if (window.coinbaseWalletExtension) candidates.push(window.coinbaseWalletExtension);
  if (window.ethereum?.providers?.length) candidates.push(...window.ethereum.providers);
  if (window.ethereum) candidates.push(window.ethereum);
  return (
    candidates.find((provider) => provider?.isRabby) ||
    candidates.find((provider) => provider?.isCoinbaseWallet) ||
    candidates.find((provider) => provider?.request) ||
    null
  );
}

async function requestAccounts(provider) {
  const existing = await provider.request({ method: "eth_accounts" }).catch(() => []);
  if (existing.length) return existing;
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("No wallet account returned.");
  return accounts;
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Wallet provider timed out")), timeoutMs);
    })
  ]);
}

async function findTable() {
  if (!state.tableSelected) {
    chooseTable();
    return;
  }
  if (!isSelectedSeatOpen()) {
    setStatus("Choose an open seat first.");
    return;
  }

  await ensureWallet();
  const seat = state.selectedSeat;
  const value = parseEthInput(elements.stakeInput.value);
  await sendTx(`Taking seat ${seat + 1} at the low-limit 6-max table...`, () =>
    state.writeContract.joinSeat(seat, { value })
  );
}

async function topUpStack() {
  await ensureWallet();
  const value = parseEthInput(elements.stakeInput.value);
  await sendTx("Adding ETH to table stack...", () => state.writeContract.topUpStack({ value }));
}

async function payAnte() {
  await ensureWallet();
  const value = state.table?.handAnte || parseEthInput(CONFIG.defaultBetEth || "0.00001");
  await sendTx("Confirming hand start with ante transaction...", () => state.writeContract.payAnte({ value }));
}

async function commitNumber() {
  await ensureWallet();
  const { hexlify, randomBytes, solidityPackedKeccak256 } = await getEthers();
  const number = Number(elements.numberSelect.value);
  const salt = hexlify(randomBytes(32));
  const commitHash = solidityPackedKeccak256(["uint8", "bytes32"], [number, salt]);
  saveLocalCommit(number, salt);
  await sendTx("Submitting hidden hand commit...", () => state.writeContract.commitNumber(commitHash));
}

async function bet() {
  await ensureWallet();
  const value = parseEthInput(elements.betInput.value);
  await sendTx("Sending ETH bet into the hand pot...", () => state.writeContract.bet(value, { value }));
}

async function callBet() {
  const due = callDue();
  if (due <= 0n) {
    setStatus("No bet to call.");
    return;
  }
  await sendTx("Calling with matching ETH into the pot...", () => state.writeContract["call"]({ value: due }));
}

async function raiseBet() {
  await ensureWallet();
  const value = parseEthInput(elements.betInput.value);
  await sendTx("Raising with a new ETH transaction...", () => state.writeContract.raiseBet(value, { value }));
}

async function reveal() {
  const commit = getLocalCommit();
  if (!commit) {
    setStatus("No local hidden hand found. Commit on this device before revealing.");
    return;
  }
  await sendTx("Revealing hidden hand...", () =>
    state.writeContract.reveal(Number(commit.number), commit.salt)
  );
}

async function sendAction(functionName, message) {
  await sendTx(message || `Sending ${functionName} transaction...`, () => state.writeContract[functionName]());
}

async function sendTx(message, buildTx) {
  try {
    await ensureWallet();
    state.busy = true;
    refreshControls();
    setStatus(message);
    const tx = await buildTx();
    setStatus(`Transaction pending: ${shortTx(tx.hash)}...`);
    await tx.wait();
    setStatus(`Transaction confirmed: ${shortTx(tx.hash)}.`);
    await refreshTable();
  } catch (error) {
    setStatus(getWalletError(error, "Transaction failed."));
  } finally {
    state.busy = false;
    refreshControls();
  }
}

async function ensureWallet() {
  if (!state.tableSelected) {
    chooseTable();
  }
  if (!isAddress(CONTRACT_ADDRESS)) {
    throw new Error("Set GAME_CONTRACT_ADDRESS first.");
  }
  if (!state.writeContract || !state.account) {
    await connectWallet();
  }
  if (!state.writeContract || !state.account) {
    throw new Error("Connect wallet first.");
  }
}

async function refreshTable() {
  if (!state.readContract) {
    renderEmpty();
    return;
  }

  const [
    gameState,
    seats,
    seatCount,
    handNumber,
    handAnte,
    minBuyIn,
    handPot,
    currentBet,
    currentActorSeat,
    timeoutAt,
    feeBps
  ] = await Promise.all([
    state.readContract.gameState(),
    state.readContract.getSeats(),
    state.readContract.seatCount(),
    state.readContract.roundNumber(),
    state.readContract.handAnte(),
    state.readContract.minBuyIn(),
    state.readContract.roundPot(),
    state.readContract.currentBet(),
    state.readContract.currentActorSeat(),
    state.readContract.timeoutAt(),
    state.readContract.DEVELOPER_FEE_BPS()
  ]);

  const seatDetails = await Promise.all(
    Array.from(seats).map(async (address, index) => {
      const occupied = isAddress(address) && address !== zeroAddress();
      if (!occupied) {
        return emptySeat(index);
      }
      const [stack, paidAnte, active, folded, contribution, committed, revealed, number] = await Promise.all([
        state.readContract.stacks(address),
        state.readContract.hasPaidAnte(address),
        state.readContract.isActiveInHand(address),
        state.readContract.hasFolded(address),
        state.readContract.handContribution(address),
        state.readContract.hasCommitted(address),
        state.readContract.hasRevealed(address),
        state.readContract.revealedNumbers(address)
      ]);
      return {
        index,
        address,
        occupied,
        stack,
        paidAnte,
        active,
        folded,
        contribution,
        committed,
        revealed,
        number: Number(number)
      };
    })
  );

  const mySeat = state.account
    ? seatDetails.find((seat) => sameAddress(seat.address, state.account))
    : null;
  const pending = state.account ? await state.readContract.pendingWithdrawals(state.account) : 0n;

  state.table = {
    stateId: Number(gameState),
    phase: TABLE_STATES[Number(gameState)] || "UNKNOWN",
    seats: seatDetails,
    seatCount: Number(seatCount),
    handNumber: Number(handNumber),
    handAnte,
    minBuyIn,
    handPot,
    currentBet,
    currentActorSeat: Number(currentActorSeat),
    timeoutAt: Number(timeoutAt),
    feeBps: Number(feeBps),
    mySeat,
    pending
  };

  syncSelectedSeat();
  pushStackHistory(state.table);
  renderTable();
}

function emptySeat(index) {
  return {
    index,
    address: zeroAddress(),
    occupied: false,
    stack: 0n,
    paidAnte: false,
    active: false,
    folded: false,
    contribution: 0n,
    committed: false,
    revealed: false,
    number: 0
  };
}

function renderEmpty() {
  elements.phaseLabel.textContent = "Lobby";
  elements.roundPot.textContent = "0 ETH pot";
  elements.potMark.textContent = "0";
  elements.timeoutLabel.textContent = "Waiting";
  elements.actionTitle.textContent = !state.tableSelected
    ? "Enter table"
    : normalizeSeatIndex(state.selectedSeat) === -1
      ? "Pick a chair"
      : "Ready to sit";
  renderSeats(Array.from({ length: MAX_SEATS }, (_, index) => emptySeat(index)));
  refreshControls();
}

function renderTable() {
  const table = state.table;
  elements.phaseLabel.textContent = formatPhase(table.phase);
  elements.roundPot.textContent = `${formatEth(table.handPot)} pot`;
  elements.potMark.textContent = formatCompactEth(table.handPot);
  elements.currentBet.textContent = formatEth(table.currentBet);
  elements.pendingWithdrawal.textContent = formatEth(table.pending);
  elements.roundNumber.textContent = String(table.handNumber);
  elements.maxRounds.textContent = `${table.seatCount}/6`;
  elements.roundAnte.textContent = formatEth(table.handAnte);
  elements.feeBps.textContent = `${table.feeBps / 100}%`;
  elements.timeoutLabel.textContent = table.timeoutAt ? formatTimeout(table.timeoutAt) : "--";

  const occupied = table.seats.filter((seat) => seat.occupied);
  elements.player1Name.textContent = occupied[0] ? shortAddress(occupied[0].address) : "Open seat";
  elements.player2Name.textContent = occupied[1] ? shortAddress(occupied[1].address) : "Open seat";
  elements.player1Stack.textContent = occupied[0] ? formatEth(occupied[0].stack) : "0 ETH";
  elements.player2Stack.textContent = occupied[1] ? formatEth(occupied[1].stack) : "0 ETH";

  const commit = getLocalCommit();
  elements.commitInfo.textContent = commit
    ? `Hidden hand ${commit.number}, salt saved locally`
    : table.mySeat?.committed
      ? "Committed on-chain. Reveal needs local salt."
      : "No hidden hand yet.";

  elements.actionTitle.textContent = getActionTitle(table);
  renderSeats(table.seats);
  renderEventLog();
  renderChart();
  refreshControls();
}

function renderSeats(seats) {
  elements.seatGrid.innerHTML = "";
  seats.forEach((seat) => {
    const mine = state.account && sameAddress(seat.address, state.account);
    const card = document.createElement("div");
    card.className = [
      "seat-card",
      seat.occupied ? "occupied" : "open",
      seat.active ? "active" : "",
      seat.folded ? "folded" : "",
      state.selectedSeat === seat.index && !seat.occupied ? "selected" : "",
      mine ? "mine" : ""
    ].filter(Boolean).join(" ");
    card.dataset.seat = String(seat.index + 1);
    const label = mine
      ? "You"
      : seat.occupied
        ? shortAddress(seat.address)
        : state.selectedSeat === seat.index
          ? "Selected"
          : "Empty";
    const detail = seat.occupied
      ? `${seat.active ? "Playing" : seat.paidAnte ? "Ante paid" : "Waiting"} - ${formatCompactEth(seat.stack)} ETH`
      : state.selectedSeat === seat.index ? "Ready to sit" : "Sit here";
    card.innerHTML = `
      <span class="chair-icon" aria-hidden="true"></span>
      <strong>${label}</strong>
      <span>${detail}</span>
    `;
    if (!seat.occupied) {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `Choose ${seatPositionName(seat.index)} seat`);
      card.addEventListener("click", () => selectSeat(seat.index));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectSeat(seat.index);
        }
      });
    }
    elements.seatGrid.append(card);
  });
}

function selectSeat(index) {
  if (!state.tableSelected) {
    setStatus("Enter the 6-seat table first, then choose a chair.");
    return;
  }

  const seatIndex = normalizeSeatIndex(index);
  if (seatIndex === -1) {
    setStatus("Choose one of the open chairs.");
    return;
  }
  const seat = state.table?.seats?.[seatIndex];
  if (seat?.occupied) {
    setStatus("That chair is already taken. Choose another open chair.");
    return;
  }

  state.selectedSeat = seatIndex;
  localStorage.setItem("poker-clash:selected-seat", String(seatIndex));
  setStatus("Chair selected. Press Sit here to send the buy-in transaction.");
  elements.actionTitle.textContent = state.table ? getActionTitle(state.table) : "Ready to sit";
  renderSeats(state.table?.seats || Array.from({ length: MAX_SEATS }, (_, seat) => emptySeat(seat)));
  refreshControls();
}

function syncSelectedSeat() {
  const seatIndex = normalizeSeatIndex(state.selectedSeat);
  if (seatIndex === -1) {
    state.selectedSeat = -1;
    return;
  }

  const seat = state.table?.seats?.[seatIndex];
  if (!seat || (seat.occupied && !sameAddress(seat.address, state.account))) {
    state.selectedSeat = -1;
    localStorage.removeItem("poker-clash:selected-seat");
  }
}

function isSelectedSeatOpen() {
  const seatIndex = normalizeSeatIndex(state.selectedSeat);
  if (!state.tableSelected || seatIndex === -1) return false;
  const seat = state.table?.seats?.[seatIndex];
  return seat ? !seat.occupied : true;
}

function getActionTitle(table) {
  if (!state.tableSelected) return "Enter table";
  if (!table.mySeat && !isSelectedSeatOpen()) return "Pick a chair";
  if (!table.mySeat) return "Ready to sit";
  if (table.phase === "WAITING") return table.seatCount < 2 ? "Waiting for player" : "Start hand";
  if (table.phase === "HAND_ANTE") {
    if (!table.mySeat) return "Players pay ante";
    return table.mySeat.paidAnte ? "Waiting for antes" : "Start hand";
  }
  if (table.phase === "HAND_COMMIT") return table.mySeat?.committed ? "Waiting for players" : "Pick strength";
  if (table.phase === "HAND_BET") return isMyTurn() ? "Your move" : "Opponent move";
  if (table.phase === "HAND_REVEAL") return table.mySeat?.revealed ? "Waiting showdown" : "Show cards";
  if (table.phase === "HAND_SETTLED") return "Hand paid out";
  if (table.phase === "TABLE_CLOSED") return "Table closed";
  return formatPhase(table.phase);
}

function refreshControls() {
  const table = state.table;
  const hasContract = Boolean(state.readContract) && isAddress(CONTRACT_ADDRESS);
  const connected = Boolean(state.account && state.writeContract);
  const phase = table?.phase || "WAITING";
  const seated = Boolean(table?.mySeat);
  const selectedOpen = isSelectedSeatOpen();
  const myTurn = isMyTurn();
  const myDue = callDue();
  const currentBet = table?.currentBet || 0n;

  setButtonsDisabled(true);

  elements.joinButton.textContent = seated
    ? "Seated"
    : selectedOpen
      ? "Sit here"
      : "Choose chair";

  elements.joinButton.disabled =
    state.busy || !state.tableSelected || !hasContract || seated || !selectedOpen || table?.seatCount >= MAX_SEATS;
  elements.topUpButton.disabled =
    state.busy || !connected || !seated || phase === "TABLE_CLOSED";
  elements.payAnteButton.disabled =
    state.busy || !connected || !seated || table?.mySeat?.paidAnte ||
    !(phase === "WAITING" || phase === "HAND_ANTE" || phase === "HAND_SETTLED") ||
    table?.seatCount < 2;
  elements.commitButton.disabled =
    state.busy || !connected || !seated || phase !== "HAND_COMMIT" || table?.mySeat?.committed || !table?.mySeat?.active;
  elements.checkButton.disabled =
    state.busy || !connected || !seated || phase !== "HAND_BET" || !myTurn || currentBet > 0n;
  elements.betButton.disabled =
    state.busy || !connected || !seated || phase !== "HAND_BET" || !myTurn || currentBet > 0n;
  elements.callButton.disabled =
    state.busy || !connected || !seated || phase !== "HAND_BET" || !myTurn || myDue <= 0n;
  elements.raiseButton.disabled =
    state.busy || !connected || !seated || phase !== "HAND_BET" || !myTurn || currentBet <= 0n;
  elements.foldButton.disabled =
    state.busy || !connected || !seated || phase !== "HAND_BET" || !myTurn;
  elements.revealButton.disabled =
    state.busy || !connected || !seated || phase !== "HAND_REVEAL" || table?.mySeat?.revealed || !table?.mySeat?.active;
  elements.timeoutButton.disabled =
    state.busy || !connected || !seated || !table?.timeoutAt || Date.now() / 1000 < table.timeoutAt;
  elements.cashOutButton.disabled =
    state.busy || !connected || !seated || table?.mySeat?.active ||
    !(phase === "WAITING" || phase === "HAND_ANTE" || phase === "HAND_SETTLED" || phase === "TABLE_CLOSED");
  elements.claimButton.disabled =
    state.busy || !connected || !table?.pending || table.pending <= 0n;

  refreshActionVisibility({ phase, seated, selectedOpen, myTurn, currentBet, table });
}

function setButtonsDisabled(disabled) {
  [
    elements.joinButton,
    elements.topUpButton,
    elements.payAnteButton,
    elements.commitButton,
    elements.betButton,
    elements.checkButton,
    elements.callButton,
    elements.raiseButton,
    elements.foldButton,
    elements.revealButton,
    elements.timeoutButton,
    elements.cashOutButton,
    elements.claimButton
  ].forEach((button) => {
    button.disabled = disabled;
  });
}

function refreshActionVisibility({ phase, seated, myTurn, currentBet, table }) {
  const waitingForSeat = !seated;
  const anteStep =
    seated &&
    table?.seatCount >= 2 &&
    (phase === "WAITING" || phase === "HAND_ANTE" || phase === "HAND_SETTLED");
  const commitStep = seated && phase === "HAND_COMMIT";
  const bettingStep = seated && phase === "HAND_BET";
  const revealStep = seated && phase === "HAND_REVEAL";
  const showTableTools = seated && phase !== "TABLE_CLOSED";
  const canTimeout = seated && table?.timeoutAt && Date.now() / 1000 >= table.timeoutAt;
  const canCashOut =
    seated &&
    !table?.mySeat?.active &&
    (phase === "WAITING" || phase === "HAND_ANTE" || phase === "HAND_SETTLED" || phase === "TABLE_CLOSED");
  const canClaim = Boolean(table?.pending && table.pending > 0n);

  setVisible(elements.stakeField, waitingForSeat);
  setVisible(elements.joinButton, waitingForSeat);
  setVisible(elements.topUpButton, showTableTools && !commitStep && !bettingStep && !revealStep);
  setVisible(elements.payAnteButton, anteStep);
  setVisible(elements.numberField, commitStep);
  setVisible(elements.commitButton, commitStep);
  setVisible(elements.betField, bettingStep && myTurn);
  setVisible(elements.betButton, bettingStep && myTurn && currentBet <= 0n);
  setVisible(elements.checkButton, bettingStep && myTurn && currentBet <= 0n);
  setVisible(elements.callButton, bettingStep && myTurn && currentBet > 0n);
  setVisible(elements.raiseButton, bettingStep && myTurn && currentBet > 0n);
  setVisible(elements.foldButton, bettingStep && myTurn);
  setVisible(elements.revealButton, revealStep);
  setVisible(elements.timeoutButton, canTimeout);
  setVisible(elements.cashOutButton, canCashOut);
  setVisible(elements.claimButton, canClaim);
}

function setVisible(element, visible) {
  if (element) element.hidden = !visible;
}

function isMyTurn() {
  if (!state.table?.mySeat) return false;
  return state.table.currentActorSeat === state.table.mySeat.index;
}

function callDue() {
  const table = state.table;
  if (!table?.mySeat || table.currentBet <= table.mySeat.contribution) return 0n;
  return table.currentBet - table.mySeat.contribution;
}

function pushStackHistory(table) {
  const occupied = table.seats.filter((seat) => seat.occupied);
  const first = occupied[0]?.stack || 0n;
  const second = occupied[1]?.stack || 0n;
  const key = `${table.phase}:${table.handNumber}:${first}:${second}:${table.handPot}:${table.seatCount}`;
  if (state.history[state.history.length - 1]?.key === key) return;
  state.history.push({
    key,
    phase: table.phase,
    hand: table.handNumber,
    stack1: first,
    stack2: second,
    pot: table.handPot
  });
  state.history = state.history.slice(-12);
}

function renderChart() {
  elements.stackChart.innerHTML = "";
  const max = state.history.reduce((value, item) => {
    return item.stack1 > value ? item.stack1 : item.stack2 > value ? item.stack2 : value;
  }, 1n);

  state.history.forEach((item) => {
    const row = document.createElement("div");
    row.className = "chart-row";
    row.innerHTML = `
      <span>H${item.hand}</span>
      <div class="chart-bar p1" style="width:${barWidth(item.stack1, max)}%"></div>
      <div class="chart-bar p2" style="width:${barWidth(item.stack2, max)}%"></div>
    `;
    elements.stackChart.append(row);
  });
}

function renderEventLog() {
  elements.eventLog.innerHTML = "";
  state.history.slice(-6).reverse().forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="rank">H${item.hand}</span>
      <span class="name">${escapeHtml(formatPhase(item.phase))} - pot ${formatEth(item.pot)}</span>
      <span class="points">${formatCompactEth(item.stack1)} / ${formatCompactEth(item.stack2)}</span>
    `;
    elements.eventLog.append(li);
  });
}

function startPolling() {
  clearInterval(state.pollId);
  state.pollId = window.setInterval(() => {
    refreshTable().catch((error) => console.info("Refresh skipped:", error.message));
  }, 5000);
  clearInterval(state.chatPollId);
  state.chatPollId = window.setInterval(() => {
    refreshChats().catch((error) => console.info("Chat refresh skipped:", error.message));
  }, 4000);
}

async function refreshChats() {
  const [lobby, table] = await Promise.all([loadChat("lobby"), loadChat("table")]);
  renderLastChat(elements.lobbyLastChat, lobby);
  renderLastChat(elements.tableLastChat, table);
}

async function loadChat(room) {
  try {
    const response = await fetch(`/api/chat?room=${encodeURIComponent(room)}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

function renderLastChat(element, messages) {
  const last = messages[messages.length - 1];
  if (!last) return;
  element.textContent = `${last.player || "anon"}: ${last.message}`;
}

async function sendChat(event, room) {
  event.preventDefault();
  const input = room === "lobby" ? elements.lobbyChatInput : elements.tableChatInput;
  const message = input.value.trim();
  if (!message) return;
  input.value = "";

  try {
    await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        room,
        message,
        player: state.account ? shortAddress(state.account) : "guest"
      })
    });
    await refreshChats();
  } catch {
    setStatus("Chat is unavailable on this server.");
  }
}

async function ensureBaseChain(provider) {
  const chainId = await provider.request({ method: "eth_chainId" });
  if (chainId?.toLowerCase() === BASE_CHAIN.hex.toLowerCase()) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN.hex }]
    });
  } catch (switchError) {
    if (switchError.code !== 4902) throw switchError;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: BASE_CHAIN.hex,
          chainName: BASE_CHAIN.name,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [BASE_CHAIN.rpcUrl],
          blockExplorerUrls: [BASE_CHAIN.explorerUrl]
        }
      ]
    });
  }
}

async function getEthers() {
  if (!state.ethers) {
    state.ethers = await import("https://esm.sh/ethers@6.13.5");
  }
  return state.ethers;
}

function parseEthInput(value) {
  const { parseEther } = state.ethers || {};
  if (!parseEther) throw new Error("Wallet library is not ready yet.");
  return parseEther(String(value || "0").trim() || "0");
}

function saveLocalCommit(number, salt) {
  if (!state.account || !CONTRACT_ADDRESS) return;
  localStorage.setItem(commitStorageKey(), JSON.stringify({ number, salt, hand: state.table?.handNumber || 0 }));
}

function getLocalCommit() {
  if (!state.account || !CONTRACT_ADDRESS || !state.table) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(commitStorageKey()) || "null");
    return parsed?.number && parsed?.salt ? parsed : null;
  } catch {
    return null;
  }
}

function commitStorageKey() {
  const hand = state.table?.handNumber || 0;
  return `poker-clash:commit:${CONTRACT_ADDRESS.toLowerCase()}:${state.account.toLowerCase()}:hand:${hand}`;
}

function attachContractEvents() {
  if (!state.readContract || state.eventsAttached) return;
  state.eventsAttached = true;

  [
    "PlayerJoined",
    "HandStarted",
    "AntePaid",
    "PlayerBet",
    "PlayerCalled",
    "PlayerRaised",
    "PlayerFolded",
    "PlayerChecked",
    "HandSettled",
    "PayoutSent",
    "PayoutCredited",
    "StacksUpdated"
  ].forEach((eventName) => {
    state.readContract.on(eventName, (...args) => {
      const event = args[args.length - 1];
      setStatus(formatChainEvent(eventName, args, event?.log?.transactionHash));
      refreshTable().catch((error) => console.info("Event refresh skipped:", error.message));
    });
  });
}

function formatChainEvent(eventName, args, txHash) {
  const tx = txHash ? ` ${shortTx(txHash)}` : "";
  if (eventName === "PlayerJoined") return `${shortAddress(args[0])} took seat ${Number(args[1]) + 1}.${tx}`;
  if (eventName === "AntePaid") return `${shortAddress(args[0])} confirmed ante ${formatEth(args[1])}.${tx}`;
  if (eventName === "PlayerBet") return `${shortAddress(args[0])} bet ${formatEth(args[1])}.${tx}`;
  if (eventName === "PlayerCalled") return `${shortAddress(args[0])} called ${formatEth(args[1])}.${tx}`;
  if (eventName === "PlayerRaised") return `${shortAddress(args[0])} raised ${formatEth(args[1])}.${tx}`;
  if (eventName === "PlayerFolded") return `${shortAddress(args[0])} folded.${tx}`;
  if (eventName === "PlayerChecked") return `${shortAddress(args[0])} checked.${tx}`;
  if (eventName === "HandStarted") return `Hand ${args[0].toString()} is waiting for antes.${tx}`;
  if (eventName === "HandSettled") return `Hand paid. Winner ${shortAddress(args[1])}, payout ${formatEth(args[3])}, fee ${formatEth(args[4])}.${tx}`;
  if (eventName === "PayoutSent") return `Payout sent to ${shortAddress(args[0])}: ${formatEth(args[1])}.${tx}`;
  if (eventName === "PayoutCredited") return `Fallback claim credited to ${shortAddress(args[0])}: ${formatEth(args[1])}.${tx}`;
  return `${eventName.replace(/([A-Z])/g, " $1").trim()}.${tx}`;
}

function formatPhase(value) {
  const labels = {
    WAITING: "Waiting",
    HAND_ANTE: "Ante",
    HAND_COMMIT: "Pick",
    HAND_BET: "Betting",
    HAND_REVEAL: "Showdown",
    HAND_SETTLED: "Paid",
    TABLE_CLOSED: "Closed"
  };
  return labels[value] || "Lobby";
}

function formatTimeout(timestamp) {
  const seconds = Math.max(0, Math.ceil(timestamp - Date.now() / 1000));
  if (seconds <= 0) return "Now";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function barWidth(value, max) {
  if (max <= 0n) return 0;
  return Number((value * 100n) / max);
}

function formatEth(value) {
  const formatter = state.ethers?.formatEther;
  if (!formatter) return "0 ETH";
  const raw = formatter(BigInt(value || 0));
  const [whole, fraction = ""] = raw.split(".");
  const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
  return `${trimmed ? `${whole}.${trimmed}` : whole} ETH`;
}

function formatCompactEth(value) {
  return formatEth(value).replace(" ETH", "");
}

function setStatus(message) {
  elements.statusLine.textContent = message;
}

function showFatalError(error) {
  console.error(error);
  setStatus(`App startup error: ${error?.message || error}`);
  refreshControls();
}

function getWalletError(error, fallback) {
  const message = String(error?.shortMessage || error?.message || error || "");
  if (error?.code === 4001 || message.toLowerCase().includes("user rejected")) {
    return "Wallet request rejected.";
  }
  return message || fallback;
}

function sameAddress(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function normalizeSeatIndex(value) {
  const seat = Number(value);
  return Number.isInteger(seat) && seat >= 0 && seat < MAX_SEATS ? seat : -1;
}

function seatPositionName(index) {
  return ["top-left", "top", "top-right", "bottom-left", "bottom", "bottom-right"][index] || "open";
}

function zeroAddress() {
  return "0x0000000000000000000000000000000000000000";
}

function shortAddress(address) {
  if (!address || address === zeroAddress()) return "Open";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortTx(hash) {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
