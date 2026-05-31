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
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const STAGES = [
  "waiting",
  "confirming",
  "waiting_for_commit",
  "waiting_for_reveal",
  "seed_ready",
  "dealing",
  "preflop",
  "flop",
  "turn",
  "river",
  "showdown",
  "finished",
  "waiting_for_vrf"
];
const ACTIVE_STAGES = new Set(["preflop", "flop", "turn", "river"]);
const CONTRACT_ABI = [
  "function joinTable(bytes32 tableId) payable",
  "function confirm(bytes32 tableId)",
  "function commitSeed(bytes32 tableId,uint256 handId,bytes32 commit)",
  "function revealSeed(bytes32 tableId,uint256 handId,string secret)",
  "function requestVrfSeed(bytes32 tableId,uint256 handId)",
  "function timeoutReveal(bytes32 tableId,uint256 handId)",
  "function payStreetAnte(bytes32 tableId) payable",
  "function check(bytes32 tableId)",
  "function bet(bytes32 tableId) payable",
  "function call(bytes32 tableId) payable",
  "function fold(bytes32 tableId)",
  "function timeout(bytes32 tableId)",
  "function submitResult(bytes32 tableId,address winner)",
  "function claimWinnings()",
  "function getTable(bytes32 tableId) view returns (tuple(bool exists,address player1,address player2,uint256 stake,uint256 pot,uint8 stage,address turn,uint256 actionDeadline,uint256 currentBet,uint8 actionsThisStage,bool confirmed1,bool confirmed2,uint256 handId,uint256 streetAnte,bool streetAntePaid1,bool streetAntePaid2,address winner,bool refunded))",
  "function getHandSeed(bytes32 tableId,uint256 handId) view returns (tuple(bytes32 commit1,bytes32 commit2,string secret1,string secret2,bool revealed1,bool revealed2,bytes32 seed,bool ready,uint256 vrfRequestId,uint256 vrfWord,bool vrfReady))",
  "function pendingWithdrawals(address) view returns (uint256)",
  "function defaultStake() view returns (uint256)",
  "function defaultStreetAnte() view returns (uint256)",
  "function vrfConfigured() view returns (bool)",
  "event TableCreated(bytes32 indexed tableId, address indexed creator, uint256 stake)",
  "event PlayerJoined(bytes32 indexed tableId, address indexed player, uint8 seat, uint256 stake)",
  "event TableJoined(bytes32 indexed tableId, address indexed player, uint256 stake)",
  "event TableReady(bytes32 indexed tableId, address indexed player1, address indexed player2, uint256 pot)",
  "event PlayerConfirmed(bytes32 indexed tableId, address indexed player)",
  "event StageChanged(bytes32 indexed tableId, uint8 stage, address turn, uint256 actionDeadline)",
  "event StreetAntePaid(bytes32 indexed tableId, uint256 indexed handId, address indexed player, uint256 amount, uint8 street)",
  "event SeedCommitted(bytes32 indexed tableId, uint256 indexed handId, address indexed player, bytes32 commit)",
  "event SeedRevealed(bytes32 indexed tableId, uint256 indexed handId, address indexed player, string secret)",
  "event HandSeedReady(bytes32 indexed tableId, uint256 indexed handId, bytes32 seed)",
  "event VrfSeedRequested(bytes32 indexed tableId, uint256 indexed handId, uint256 indexed requestId)",
  "event VrfSeedFulfilled(bytes32 indexed tableId, uint256 indexed handId, uint256 indexed requestId, uint256 randomWord)",
  "event RevealTimedOut(bytes32 indexed tableId, uint256 indexed handId, address indexed inactivePlayer, address winner)",
  "event PlayerChecked(bytes32 indexed tableId, address indexed player)",
  "event PlayerBet(bytes32 indexed tableId, address indexed player, uint256 amount)",
  "event PlayerCalled(bytes32 indexed tableId, address indexed player, uint256 amount)",
  "event PlayerFolded(bytes32 indexed tableId, address indexed player, address indexed winner)",
  "event ActionSubmitted(bytes32 indexed tableId, address indexed player, string action, uint256 amount)",
  "event PlayerTimedOut(bytes32 indexed tableId, address indexed inactivePlayer, address indexed winner)",
  "event TableSettled(bytes32 indexed tableId, address indexed winner, uint256 payout, uint256 developerFee)",
  "event HandFinished(bytes32 indexed tableId, address indexed winner, uint256 payout, uint256 developerFee)"
];

const BASE_CHAIN = {
  id: Number(CONFIG.chain?.id || 84532),
  hex: CONFIG.chain?.hex || `0x${Number(CONFIG.chain?.id || 84532).toString(16)}`,
  name: CONFIG.chain?.name || "Base Sepolia",
  rpcUrl: CONFIG.chain?.rpcUrl || "https://sepolia.base.org",
  explorerUrl: CONFIG.chain?.explorerUrl || "https://sepolia-explorer.base.org"
};

const state = {
  sdk: null,
  provider: null,
  ethers: null,
  account: "",
  walletOptionId: localStorage.getItem("pokerWalletOptionId") || "",
  readContract: null,
  writeContract: null,
  tableId: "",
  offchainTable: null,
  chainTable: null,
  chainHandSeed: null,
  pendingClaim: 0n,
  busy: false,
  pollId: null,
  timerId: null,
  eventsAttached: false
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  saveMiniApp: $("#saveMiniApp"),
  shareMiniApp: $("#shareMiniApp"),
  adminButton: $("#adminButton"),
  connectWallet: $("#connectWallet"),
  lobbyScreen: $("#lobbyScreen"),
  tableScreen: $("#tableScreen"),
  adminScreen: $("#adminScreen"),
  startGameButton: $("#startGameButton"),
  lobbyStatus: $("#lobbyStatus"),
  lobbyStake: $("#lobbyStake"),
  lobbyNetwork: $("#lobbyNetwork"),
  lobbyContract: $("#lobbyContract"),
  lobbyLastChat: $("#lobbyLastChat"),
  lobbyChatForm: $("#lobbyChatForm"),
  lobbyChatInput: $("#lobbyChatInput"),
  backToLobbyButton: $("#backToLobbyButton"),
  tableIdLabel: $("#tableIdLabel"),
  timerLabel: $("#timerLabel"),
  player1Label: $("#player1Label"),
  player2Label: $("#player2Label"),
  potLabel: $("#potLabel"),
  stakeLabel: $("#stakeLabel"),
  stageLabel: $("#stageLabel"),
  turnLabel: $("#turnLabel"),
  communityCards: $("#communityCards"),
  playerCards: $("#playerCards"),
  confirmButton: $("#confirmButton"),
  commitSeedButton: $("#commitSeedButton"),
  revealSeedButton: $("#revealSeedButton"),
  streetAnteButton: $("#streetAnteButton"),
  checkButton: $("#checkButton"),
  betField: $("#betField"),
  betInput: $("#betInput"),
  betButton: $("#betButton"),
  callButton: $("#callButton"),
  foldButton: $("#foldButton"),
  timeoutButton: $("#timeoutButton"),
  settleButton: $("#settleButton"),
  claimButton: $("#claimButton"),
  tableStatus: $("#tableStatus"),
  tableLastChat: $("#tableLastChat"),
  tableChatForm: $("#tableChatForm"),
  tableChatInput: $("#tableChatInput"),
  adminBackButton: $("#adminBackButton"),
  adminTokenInput: $("#adminTokenInput"),
  adminUnlockButton: $("#adminUnlockButton"),
  adminFillBotButton: $("#adminFillBotButton"),
  adminCreateBotButton: $("#adminCreateBotButton"),
  adminRefreshButton: $("#adminRefreshButton"),
  adminResetLobbyButton: $("#adminResetLobbyButton"),
  adminStatus: $("#adminStatus"),
  adminState: $("#adminState"),
  walletSheet: $("#walletSheet"),
  walletOptions: $("#walletOptions"),
  walletCancelButton: $("#walletCancelButton"),
  walletPickerStatus: $("#walletPickerStatus"),
  fairPanel: $("#fairPanel"),
  fairCommit1: $("#fairCommit1"),
  fairCommit2: $("#fairCommit2"),
  fairSecret1: $("#fairSecret1"),
  fairSecret2: $("#fairSecret2"),
  fairVrfRequest: $("#fairVrfRequest"),
  fairVrfWord: $("#fairVrfWord"),
  fairSeed: $("#fairSeed"),
  fairDeckHash: $("#fairDeckHash"),
  verifyHandButton: $("#verifyHandButton"),
  fairVerifyStatus: $("#fairVerifyStatus")
};

boot().catch((error) => showError(error.message || "App failed to start."));

async function boot() {
  elements.lobbyStake.textContent = `${CONFIG.defaultStakeEth || "0.0001"} ETH`;
  elements.lobbyNetwork.textContent = BASE_CHAIN.name;
  elements.lobbyContract.textContent = isAddress(CONTRACT_ADDRESS) ? shortAddress(CONTRACT_ADDRESS) : "Not configured";
  elements.betInput.value = CONFIG.defaultBetEth || "0.00001";
  elements.adminTokenInput.value = sessionStorage.getItem("pokerAdminToken") || "";
  bindEvents();
  renderRoute();
  await initMiniApp().catch((error) => console.info("Mini App init skipped:", error.message));
  await initReadContract();
  await refreshWalletFromProvider().catch(() => {});
  await restoreActiveTable({ navigate: !state.tableId && window.location.hash !== "#/admin" }).catch(() => {});
  startPolling();
}

function bindEvents() {
  window.addEventListener("hashchange", renderRoute);
  elements.connectWallet.addEventListener("click", openWalletPicker);
  elements.walletCancelButton.addEventListener("click", closeWalletPicker);
  elements.adminButton.addEventListener("click", () => {
    window.location.hash = "#/admin";
  });
  elements.startGameButton.addEventListener("click", startGame);
  elements.backToLobbyButton.addEventListener("click", () => {
    window.location.hash = "";
  });
  elements.adminBackButton.addEventListener("click", () => {
    window.location.hash = "";
  });
  elements.saveMiniApp.addEventListener("click", saveMiniApp);
  elements.shareMiniApp.addEventListener("click", shareMiniApp);
  elements.confirmButton.addEventListener("click", confirmOrJoin);
  elements.commitSeedButton.addEventListener("click", commitSeed);
  elements.revealSeedButton.addEventListener("click", revealSeed);
  elements.streetAnteButton.addEventListener("click", payStreetAnte);
  elements.checkButton.addEventListener("click", checkAction);
  elements.betButton.addEventListener("click", bet);
  elements.callButton.addEventListener("click", callBet);
  elements.foldButton.addEventListener("click", foldAction);
  elements.timeoutButton.addEventListener("click", timeoutAction);
  elements.verifyHandButton.addEventListener("click", verifyFairHand);
  elements.settleButton.addEventListener("click", settleShowdown);
  elements.claimButton.addEventListener("click", () => sendTableTx("claim", () => state.writeContract.claimWinnings(txOpts())));
  elements.lobbyChatForm.addEventListener("submit", sendLobbyChat);
  elements.tableChatForm.addEventListener("submit", sendTableChat);
  elements.adminFillBotButton.addEventListener("click", () => adminAction("/api/admin/bots/fill-waiting"));
  elements.adminCreateBotButton.addEventListener("click", () => adminAction("/api/admin/bots/create-waiting"));
  elements.adminRefreshButton.addEventListener("click", loadAdminState);
  elements.adminResetLobbyButton.addEventListener("click", () => adminAction("/api/admin/reset-lobby"));
  elements.adminUnlockButton.addEventListener("click", loadAdminState);
  elements.adminTokenInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadAdminState();
    }
  });
  elements.adminTokenInput.addEventListener("input", () => {
    const token = elements.adminTokenInput.value.trim();
    if (token) sessionStorage.setItem("pokerAdminToken", token);
  });
}

async function initMiniApp() {
  try {
    const module = await import("https://esm.sh/@farcaster/miniapp-sdk");
    state.sdk = module.sdk;
    await state.sdk.actions.ready();
    elements.saveMiniApp.hidden = typeof state.sdk.actions?.addMiniApp !== "function";
    elements.shareMiniApp.hidden = typeof state.sdk.actions?.composeCast !== "function";
  } catch (error) {
    console.info("Farcaster SDK unavailable:", error.message);
  }
}

async function initReadContract() {
  if (!isAddress(CONTRACT_ADDRESS)) {
    setLobbyStatus("Contract not configured yet.");
    renderControls();
    return;
  }

  const { Contract, JsonRpcProvider } = await getEthers();
  const provider = new JsonRpcProvider(BASE_CHAIN.rpcUrl, BASE_CHAIN.id);
  state.readContract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
  attachEvents();
}

function renderRoute() {
  const adminRoute = window.location.hash === "#/admin";
  const tableId = currentRouteTableId();
  state.tableId = adminRoute ? "" : tableId;
  document.body.classList.toggle("table-route", Boolean(tableId) && !adminRoute);
  document.body.classList.toggle("admin-route", adminRoute);
  elements.lobbyScreen.hidden = Boolean(tableId) || adminRoute;
  elements.tableScreen.hidden = !tableId || adminRoute;
  elements.adminScreen.hidden = !adminRoute;

  if (adminRoute) {
    state.offchainTable = null;
    state.chainTable = null;
    loadAdminState();
  } else if (tableId) {
    elements.tableIdLabel.textContent = shortTableId(tableId);
    rememberLastTable(tableId);
    refreshTable();
  } else {
    state.tableId = "";
    state.offchainTable = null;
    state.chainTable = null;
    refreshLobbyChat();
    renderControls();
  }
}

async function openWalletPicker() {
  const options = await detectWalletOptions();
  elements.walletOptions.innerHTML = "";
  elements.walletPickerStatus.textContent = options.length
    ? "Choose an available wallet provider."
    : "No injected wallet provider found. Open in Farcaster, Rabby, MetaMask, OKX, or Coinbase Wallet.";

  for (const option of options) {
    const button = document.createElement("button");
    button.className = "wallet-option";
    button.type = "button";
    button.innerHTML = `<span>${option.label}</span><small>${option.detail}</small>`;
    button.addEventListener("click", () => connectWallet(option));
    elements.walletOptions.append(button);
  }

  elements.walletSheet.hidden = false;
}

function closeWalletPicker() {
  elements.walletSheet.hidden = true;
}

async function connectWallet(option) {
  if (!option) {
    const saved = await walletOptionById(state.walletOptionId);
    if (saved) {
      return connectWallet(saved);
    }
    await openWalletPicker();
    return;
  }

  try {
    state.provider = await option.getProvider();
    if (!state.provider?.request) {
      setLobbyStatus("Selected wallet provider is unavailable.");
      return;
    }

    const accounts = await requestAccounts(state.provider);
    state.account = accounts[0];
    state.walletOptionId = option.id;
    localStorage.setItem("pokerWalletOptionId", option.id);
    elements.connectWallet.textContent = shortAddress(state.account);
    await ensureBaseChain(state.provider);
    await rebuildWriteContract();

    closeWalletPicker();
    setLobbyStatus("Wallet connected.");
    renderControls();
    await restoreActiveTable({ navigate: !state.tableId && window.location.hash !== "#/admin" }).catch(() => {});
    if (state.tableId) await refreshTable();
  } catch (error) {
    showError(walletError(error, "Wallet connection failed."));
  }
}

async function refreshWalletFromProvider() {
  const provider = await getWalletProvider();
  const accounts = provider?.request ? await provider.request({ method: "eth_accounts" }).catch(() => []) : [];
  if (accounts?.length) {
    state.provider = provider;
    state.account = accounts[0];
    elements.connectWallet.textContent = shortAddress(state.account);
    await rebuildWriteContract();
  }
  renderControls();
}

async function getWalletProvider() {
  const options = await detectWalletOptions();
  const preferred = options.find((option) => option.id === state.walletOptionId) || options.find((option) => option.id === "farcaster") || options[0];
  return preferred ? preferred.getProvider() : null;
}

async function walletOptionById(id) {
  if (!id) return null;
  const options = await detectWalletOptions();
  return options.find((option) => option.id === id) || null;
}

async function refreshSelectedProvider() {
  const option = await walletOptionById(state.walletOptionId);
  if (option) {
    state.provider = await option.getProvider();
  }
  if (!state.provider?.request) {
    state.provider = await getWalletProvider();
  }
  return state.provider;
}

async function rebuildWriteContract() {
  if (!isAddress(CONTRACT_ADDRESS) || !state.provider?.request) return;
  const { BrowserProvider, Contract } = await getEthers();
  const browserProvider = new BrowserProvider(state.provider);
  const accounts = await requestAccounts(state.provider);
  if (accounts?.length) {
    state.account = accounts[0];
    elements.connectWallet.textContent = shortAddress(state.account);
  }
  const signer = await browserProvider.getSigner(state.account);
  state.writeContract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
}

async function detectWalletOptions() {
  const options = [];
  const seen = new Set();
  const push = (id, label, provider, detail = "Browser wallet") => {
    if (!provider?.request || seen.has(id)) return;
    seen.add(id);
    options.push({ id, label, detail, getProvider: async () => provider });
  };

  if (state.sdk?.wallet?.getEthereumProvider && !seen.has("farcaster")) {
    options.push({
      id: "farcaster",
      label: "Farcaster Wallet",
      detail: "Mini App provider",
      getProvider: async () => withTimeout(state.sdk.wallet.getEthereumProvider(), 5000)
    });
    seen.add("farcaster");
  }

  push("rabby-global", "Rabby Wallet", window.rabby, "Detected extension");
  push("okx-global", "OKX Wallet", window.okxwallet, "Detected extension");
  push("coinbase-global", "Coinbase Wallet", window.coinbaseWalletExtension, "Detected extension");

  const injected = window.ethereum?.providers?.length ? window.ethereum.providers : window.ethereum ? [window.ethereum] : [];
  for (const provider of injected) {
    if (provider?.isRabby) push("rabby", "Rabby Wallet", provider, "Injected provider");
    else if (provider?.isMetaMask) push("metamask", "MetaMask", provider, "Injected provider");
    else if (provider?.isOkxWallet || provider?.isOKExWallet) push("okx", "OKX Wallet", provider, "Injected provider");
    else if (provider?.isCoinbaseWallet) push("coinbase", "Coinbase Wallet", provider, "Injected provider");
    else push(`wallet-${options.length}`, "Browser Wallet", provider, "Injected provider");
  }

  return options;
}

async function requestAccounts(provider) {
  const existing = await provider.request({ method: "eth_accounts" }).catch(() => []);
  if (existing.length) return existing;
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("No wallet account returned.");
  return accounts;
}

async function startGame() {
  if (!state.account) {
    setLobbyStatus("Wallet not connected.");
    return;
  }

  try {
    setBusy(true, "Finding table...");
    const response = await fetch("/api/lobby/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ walletAddress: state.account })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not join lobby.");
    rememberLastTable(data.table.id);
    window.location.hash = `#/table/${data.table.id}`;
  } catch (error) {
    showError(error.message || "Lobby unavailable.");
  } finally {
    setBusy(false);
  }
}

async function restoreActiveTable({ navigate = false } = {}) {
  if (!state.account) return null;
  const localTableId = localStorage.getItem(lastTableKey()) || "";
  const url = new URL("/api/lobby/status", window.location.origin);
  url.searchParams.set("walletAddress", state.account);
  if (/^0x[a-fA-F0-9]{64}$/.test(localTableId)) {
    url.searchParams.set("tableId", localTableId);
  }

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const data = await response.json();
  const table = data.table;
  if (!table?.id) return null;

  rememberLastTable(table.id);
  setLobbyStatus(
    table.player2
      ? `Active table found: ${shortTableId(table.id)}.`
      : `Waiting table found: ${shortTableId(table.id)}.`
  );

  if (navigate && currentRouteTableId() !== table.id.toLowerCase()) {
    window.location.hash = `#/table/${table.id}`;
  }
  return table;
}

async function refreshTable() {
  if (!state.tableId) return;
  await Promise.all([refreshOffchainTable(), refreshChainTable(), refreshTableChat()]);
  await syncOffchainWithChain();
  renderTable();
}

async function refreshOffchainTable() {
  try {
    const response = await fetch(`/api/tables/${encodeURIComponent(state.tableId)}?player=${encodeURIComponent(state.account || "")}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return;
    const data = await response.json();
    state.offchainTable = data.table || null;
  } catch {
    state.offchainTable = null;
  }
}

async function refreshChainTable() {
  if (!state.readContract || !state.tableId) {
    state.chainTable = null;
    return;
  }

  try {
    const result = await state.readContract.getTable(tableIdBytes());
    const table = result?.exists === undefined && result?.[0] ? result[0] : result;
    const pending = state.account ? await state.readContract.pendingWithdrawals(state.account) : 0n;
    state.pendingClaim = pending;
    const parsedTable = {
      exists: Boolean(table.exists),
      player1: table.player1,
      player2: table.player2,
      stake: table.stake,
      pot: table.pot,
      stage: STAGES[Number(table.stage)] || "waiting",
      turn: table.turn,
      actionDeadline: Number(table.actionDeadline),
      currentBet: table.currentBet,
      confirmed1: Boolean(table.confirmed1),
      confirmed2: Boolean(table.confirmed2),
      handId: Number(table.handId || 0),
      streetAnte: table.streetAnte || 0n,
      streetAntePaid1: Boolean(table.streetAntePaid1),
      streetAntePaid2: Boolean(table.streetAntePaid2),
      winner: table.winner,
      refunded: Boolean(table.refunded)
    };
    state.chainTable = parsedTable;
    state.chainHandSeed = await readChainHandSeed(parsedTable);
  } catch (error) {
    console.info("Contract table read failed:", error.message);
    state.chainTable = null;
    state.chainHandSeed = null;
  }
}

async function readChainHandSeed(table) {
  if (!state.readContract || !table?.exists || !table.handId) return null;
  try {
    const hand = await state.readContract.getHandSeed(tableIdBytes(), BigInt(table.handId));
    return {
      commit1: hand.commit1,
      commit2: hand.commit2,
      secret1: hand.secret1,
      secret2: hand.secret2,
      revealed1: Boolean(hand.revealed1),
      revealed2: Boolean(hand.revealed2),
      seed: hand.seed,
      ready: Boolean(hand.ready),
      vrfRequestId: BigInt(hand.vrfRequestId || 0).toString(),
      vrfWord: BigInt(hand.vrfWord || 0).toString(),
      vrfReady: Boolean(hand.vrfReady)
    };
  } catch {
    return null;
  }
}

async function syncOffchainWithChain() {
  if (!state.tableId || !state.chainTable?.exists) return;
  try {
    await fetch(`/api/tables/${encodeURIComponent(state.tableId)}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        viewer: state.account,
        stage: state.chainTable.stage,
        handId: state.chainTable.handId,
        handSeed: state.chainHandSeed,
        player1: state.chainTable.player1,
        player2: state.chainTable.player2,
        winner: isAddress(state.chainTable.winner) && state.chainTable.winner !== ZERO_ADDRESS
          ? state.chainTable.winner
          : ""
      })
    });
    await refreshOffchainTable();
  } catch {
    // Off-chain cards are prototype-only; chain state still renders.
  }
}

function renderTable() {
  const chain = state.chainTable || {};
  const offchain = state.offchainTable || {};
  const simulated = Boolean(offchain.simulation);
  const stage = !simulated && chain.exists ? chain.stage : offchain.stage || "waiting";
  const player1 = !simulated && chain.exists ? chain.player1 : offchain.player1 || "";
  const player2 = !simulated && chain.exists ? chain.player2 : offchain.player2 || "";
  const pot = simulated ? `${offchain.pot || "0"} ETH` : chain.exists ? formatEth(chain.pot || 0n) : "0 ETH";
  const stake = chain.exists && chain.stake ? formatEth(chain.stake) : `${CONFIG.defaultStakeEth || "0.0001"} ETH`;

  elements.player1Label.textContent = player1 ? labelPlayer(player1) : "Waiting";
  elements.player2Label.textContent = player2 ? labelPlayer(player2) : "Waiting";
  elements.potLabel.textContent = pot;
  elements.stakeLabel.textContent = `${stake} stake`;
  elements.stageLabel.textContent = stage;
  elements.turnLabel.textContent = turnLabel(simulated ? offchain.turn : chain.turn);
  elements.tableStatus.textContent = tableStatusText(stage, chain, offchain);
  renderCards(elements.playerCards, offchain.playerCards || [], true);
  renderCards(elements.communityCards, offchain.communityCards || [], false);
  elements.fairPanel.hidden = simulated;
  if (!simulated) renderFairInfo(offchain.fair || {}, stage);
  renderControls();
  renderTimer();
}

function renderFairInfo(fair, stage) {
  const info = fair || {};
  elements.fairCommit1.textContent = shortHash(info.commits?.player1);
  elements.fairCommit2.textContent = shortHash(info.commits?.player2);
  elements.fairSecret1.textContent = info.revealedSecrets?.player1 ? shortSecret(info.revealedSecrets.player1) : "--";
  elements.fairSecret2.textContent = info.revealedSecrets?.player2 ? shortSecret(info.revealedSecrets.player2) : "--";
  elements.fairVrfRequest.textContent = info.vrfRequestId && info.vrfRequestId !== "0" ? `#${info.vrfRequestId}` : "--";
  elements.fairVrfWord.textContent = info.vrfWord && info.vrfWord !== "0" ? `${info.vrfWord.slice(0, 10)}...` : "--";
  elements.fairSeed.textContent = shortHash(info.seed);
  elements.fairDeckHash.textContent = shortHash(info.deckHash);
  elements.verifyHandButton.disabled = state.busy || !info.verifyAvailable;

  if (stage === "waiting_for_commit") {
    elements.fairVerifyStatus.textContent = "Commit your local secret. Opponent cannot see it yet.";
  } else if (stage === "waiting_for_reveal") {
    elements.fairVerifyStatus.textContent = "Reveal your local secret within 60 seconds.";
  } else if (stage === "waiting_for_vrf") {
    elements.fairVerifyStatus.textContent = "Both secrets are revealed. Waiting for Chainlink VRF to return the hand seed.";
  } else if (info.verifyAvailable && !info.deck?.length) {
    elements.fairVerifyStatus.textContent = "Seed and deck hash are ready. Full deck is revealed after showdown.";
  } else if (info.deck?.length) {
    elements.fairVerifyStatus.textContent = "Full deck is public. Press Verify hand to recompute it.";
  } else {
    elements.fairVerifyStatus.textContent = "Chainlink VRF creates the hand seed after both players reveal their local secrets.";
  }
}

function renderControls() {
  const connected = Boolean(state.account);
  const contractConfigured = isAddress(CONTRACT_ADDRESS);
  if (state.offchainTable?.simulation) {
    renderSimulationControls(connected);
    return;
  }

  const chain = state.chainTable;
  const stage = chain?.stage || "waiting";
  const isPlayer = chain?.exists && isCurrentPlayer(chain);
  const joined = isPlayer;
  const offchainReady = Boolean(state.offchainTable?.player1 && state.offchainTable?.player2);
  const needsJoin = state.tableId && offchainReady && (!chain?.exists || !joined);
  const needsConfirm = joined && stage === "confirming" && !myConfirmed(chain);
  const waitingForCommit = joined && stage === "waiting_for_commit";
  const waitingForReveal = joined && stage === "waiting_for_reveal";
  const needsStreetAnte = joined && (stage === "seed_ready" || ACTIVE_STAGES.has(stage)) && chain?.turn === ZERO_ADDRESS && !myStreetAntePaid(chain);
  const myTurn = joined && sameAddress(chain?.turn, state.account);
  const timedOut = Boolean(chain?.actionDeadline && Date.now() / 1000 > chain.actionDeadline);
  const canAct = ACTIVE_STAGES.has(stage) && myTurn && !timedOut && !needsStreetAnte;
  const canCall = canAct && BigInt(chain?.currentBet || 0) > 0n;
  const canSettle = stage === "showdown" && joined && Boolean(state.offchainTable?.winner);
  const canClaim = state.pendingClaim > 0n;

  elements.startGameButton.disabled = state.busy || !connected;
  elements.confirmButton.hidden = !(needsJoin || needsConfirm);
  elements.commitSeedButton.hidden = !waitingForCommit;
  elements.revealSeedButton.hidden = !waitingForReveal;
  elements.streetAnteButton.hidden = !needsStreetAnte;
  elements.checkButton.hidden = !(canAct && !canCall);
  elements.betField.hidden = !canAct;
  elements.betButton.hidden = !(canAct && !canCall);
  elements.callButton.hidden = !canCall;
  elements.foldButton.hidden = !canAct;
  elements.timeoutButton.hidden = !(joined && timedOut && stage !== "finished");
  elements.settleButton.hidden = !canSettle;
  elements.claimButton.hidden = !canClaim;

  elements.confirmButton.textContent = needsJoin ? "Confirm Stake" : "Confirm";
  elements.streetAnteButton.textContent = `Pay street ante ${formatEth(chain?.streetAnte || 0n)}`;
  elements.confirmButton.disabled = state.busy || !connected || !contractConfigured;
  elements.commitSeedButton.disabled = state.busy || !connected || !contractConfigured || hasMyCommit();
  elements.revealSeedButton.disabled = state.busy || !connected || !contractConfigured || !hasMyCommit() || hasMyReveal();
  elements.streetAnteButton.disabled = state.busy || !connected || !contractConfigured || !chain?.streetAnte;
  elements.checkButton.disabled = state.busy || !contractConfigured;
  elements.betButton.disabled = state.busy || !contractConfigured;
  elements.callButton.disabled = state.busy || !contractConfigured;
  elements.foldButton.disabled = state.busy || !contractConfigured;
  elements.timeoutButton.disabled = state.busy || !contractConfigured;
  elements.settleButton.disabled = state.busy || !contractConfigured;
  elements.claimButton.disabled = state.busy || !contractConfigured;

  if (!contractConfigured && state.tableId) {
    elements.tableStatus.textContent = "Contract not configured.";
  }
}

function renderSimulationControls(connected) {
  const table = state.offchainTable || {};
  const stage = table.stage || "waiting";
  const isPlayer = sameAddress(table.player1, state.account) || sameAddress(table.player2, state.account);
  const needsConfirm = connected && isPlayer && stage === "confirming";
  const myTurn = connected && isPlayer && sameAddress(table.turn, state.account);
  const canAct = ACTIVE_STAGES.has(stage) && myTurn;
  const canClaim = false;

  elements.startGameButton.disabled = state.busy || !connected;
  elements.confirmButton.hidden = !needsConfirm;
  elements.commitSeedButton.hidden = true;
  elements.revealSeedButton.hidden = true;
  elements.streetAnteButton.hidden = true;
  elements.checkButton.hidden = !canAct;
  elements.betField.hidden = !canAct;
  elements.betButton.hidden = !canAct;
  elements.callButton.hidden = true;
  elements.foldButton.hidden = !canAct;
  elements.timeoutButton.hidden = true;
  elements.settleButton.hidden = true;
  elements.claimButton.hidden = !canClaim;

  elements.confirmButton.textContent = "Start Bot Hand";
  elements.confirmButton.disabled = state.busy || !connected;
  elements.checkButton.disabled = state.busy;
  elements.betButton.disabled = state.busy;
  elements.foldButton.disabled = state.busy;
}

async function confirmOrJoin() {
  if (state.offchainTable?.simulation) {
    await simulateAction("confirm");
    return;
  }

  if (!state.chainTable?.exists || !isCurrentPlayer(state.chainTable)) {
    const value = parseEth(CONFIG.defaultStakeEth || "0.0001");
    await sendTableTx("confirm stake", () => state.writeContract.joinTable(tableIdBytes(), txOpts({ value })));
    return;
  }
  await sendTableTx("confirm", () => state.writeContract.confirm(tableIdBytes(), txOpts()));
}

async function commitSeed() {
  try {
    await ensureWalletAndNetwork();
    const handId = currentHandId();
    if (!handId) throw new Error("Hand id is not ready yet.");
    const secret = getOrCreateHandSecret(handId);
    const commit = await buildSeedCommit(secret, state.account, tableIdBytes(), handId);
    setBusy(true, "commit seed: tx pending...");
    const tx = await state.writeContract.commitSeed(tableIdBytes(), BigInt(handId), commit, txOpts());
    elements.tableStatus.textContent = `Transaction pending: ${shortTx(tx.hash)}`;
    await tx.wait();
    await postFairAction("commit", { handId, commit });
    elements.tableStatus.textContent = "Seed committed. Waiting for opponent.";
    await refreshTable();
  } catch (error) {
    showError(walletError(error, "Commit seed failed."));
  } finally {
    setBusy(false);
  }
}

async function revealSeed() {
  try {
    await ensureWalletAndNetwork();
    const handId = currentHandId();
    if (!handId) throw new Error("Hand id is not ready yet.");
    const secret = readHandSecret(handId);
    if (!secret) throw new Error("Local secret missing. This browser cannot reveal the seed it committed.");
    setBusy(true, "reveal seed: tx pending...");
    const tx = await state.writeContract.revealSeed(tableIdBytes(), BigInt(handId), secret, txOpts({}, 900000n));
    elements.tableStatus.textContent = `Transaction pending: ${shortTx(tx.hash)}`;
    await tx.wait();
    await postFairAction("reveal", { handId, secret });
    elements.tableStatus.textContent = "Seed revealed. Waiting for Chainlink VRF.";
    await refreshTable();
  } catch (error) {
    showError(walletError(error, "Reveal seed failed."));
  } finally {
    setBusy(false);
  }
}

async function payStreetAnte() {
  const value = BigInt(state.chainTable?.streetAnte || 0);
  if (value <= 0n) {
    showError("Street ante is not ready.");
    return;
  }
  await sendTableTx("street ante", () => state.writeContract.payStreetAnte(tableIdBytes(), txOpts({ value })));
}

async function timeoutAction() {
  const handId = currentHandId();
  if (["waiting_for_commit", "waiting_for_reveal"].includes(state.chainTable?.stage) && handId) {
    await sendTableTx("reveal timeout", () => state.writeContract.timeoutReveal(tableIdBytes(), BigInt(handId), txOpts()));
    return;
  }
  await sendTableTx("timeout", () => state.writeContract.timeout(tableIdBytes(), txOpts()));
}

async function checkAction() {
  if (state.offchainTable?.simulation) {
    await simulateAction("check");
    return;
  }
  await sendTableTx("check", () => state.writeContract.check(tableIdBytes(), txOpts()));
}

async function bet() {
  if (state.offchainTable?.simulation) {
    await simulateAction("bet", { amount: elements.betInput.value || CONFIG.defaultBetEth || "0.00001" });
    return;
  }

  const value = parseEth(elements.betInput.value || CONFIG.defaultBetEth || "0.00001");
  await sendTableTx("bet", () => state.writeContract.bet(tableIdBytes(), txOpts({ value })));
}

async function callBet() {
  if (state.offchainTable?.simulation) {
    await simulateAction("call");
    return;
  }

  const value = BigInt(state.chainTable?.currentBet || 0);
  if (value <= 0n) {
    showError("No open bet to call.");
    return;
  }
  await sendTableTx("call", () => state.writeContract.call(tableIdBytes(), txOpts({ value })));
}

async function foldAction() {
  if (state.offchainTable?.simulation) {
    await simulateAction("fold");
    return;
  }
  await sendTableTx("fold", () => state.writeContract.fold(tableIdBytes(), txOpts()));
}

async function settleShowdown() {
  const winner = state.offchainTable?.winner;
  if (!isAddress(winner)) {
    showError("Off-chain winner is not ready yet.");
    return;
  }
  await sendTableTx("settle", () => state.writeContract.submitResult(tableIdBytes(), winner, txOpts()));
}

async function simulateAction(action, extra = {}) {
  if (!state.account) {
    showError("Wallet not connected.");
    return;
  }

  try {
    setBusy(true, `${action}: bot simulation...`);
    const response = await fetch(`/api/tables/${encodeURIComponent(state.tableId)}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ walletAddress: state.account, action, ...extra })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Simulation action failed.");
    state.offchainTable = data.table;
    renderTable();
  } catch (error) {
    showError(error.message || "Simulation action failed.");
  } finally {
    setBusy(false);
  }
}

async function sendTableTx(label, buildTx) {
  try {
    await ensureWalletAndNetwork();
    setBusy(true, `${label}: tx pending...`);
    const tx = await buildTx();
    elements.tableStatus.textContent = `Transaction pending: ${shortTx(tx.hash)}`;
    await tx.wait();
    elements.tableStatus.textContent = `Transaction confirmed: ${shortTx(tx.hash)}`;
    await refreshTable();
  } catch (error) {
    showError(walletError(error, `${label} failed.`));
  } finally {
    setBusy(false);
  }
}

async function ensureWalletAndNetwork() {
  if (!state.account) {
    await connectWallet();
  }
  if (!state.account) {
    throw new Error("Wallet not connected.");
  }
  if (!isAddress(CONTRACT_ADDRESS)) {
    throw new Error("Contract not configured.");
  }
  const provider = await refreshSelectedProvider();
  if (!provider?.request) throw new Error("Wallet provider not ready.");
  await ensureBaseChain(provider);
  await rebuildWriteContract();
  if (!state.writeContract) {
    throw new Error("Contract not ready.");
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
    if (switchError.code !== 4902) {
      throw new Error(`Wrong network. Switch to ${BASE_CHAIN.name} in your wallet, then try again.`);
    }
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

  const updatedChainId = await provider.request({ method: "eth_chainId" }).catch(() => "");
  if (updatedChainId?.toLowerCase() !== BASE_CHAIN.hex.toLowerCase()) {
    throw new Error(`Wrong network. Switch to ${BASE_CHAIN.name} in your wallet, then try again.`);
  }
}

function txOpts(extra = {}, gasLimit = 600000n) {
  return { gasLimit, ...extra };
}

function renderCards(container, cards, showBacks) {
  const visibleCards = Array.isArray(cards) ? cards : [];
  const placeholders = showBacks ? 2 : 5;
  container.innerHTML = "";
  for (let i = 0; i < Math.max(placeholders, visibleCards.length); i += 1) {
    const card = visibleCards[i];
    const element = document.createElement("span");
    element.className = card ? `card ${cardSuit(card)}` : "card back";
    element.textContent = card ? formatCard(card) : "";
    container.append(element);
  }
}

function renderTimer() {
  const deadline = state.chainTable?.actionDeadline || 0;
  if (!deadline || state.chainTable?.stage === "finished") {
    elements.timerLabel.textContent = "--";
    return;
  }
  const seconds = Math.max(0, Math.ceil(deadline - Date.now() / 1000));
  elements.timerLabel.textContent = `${seconds}s`;
}

function startPolling() {
  clearInterval(state.pollId);
  state.pollId = window.setInterval(() => {
    if (state.tableId) refreshTable().catch((error) => console.info("refresh skipped:", error.message));
    else refreshLobbyChat().catch((error) => console.info("lobby chat refresh skipped:", error.message));
  }, 5000);
  clearInterval(state.timerId);
  state.timerId = window.setInterval(renderTimer, 1000);
}

async function refreshLobbyChat() {
  try {
    const response = await fetch("/api/chat?room=lobby");
    if (!response.ok) return;
    const data = await response.json();
    const last = data.messages?.[data.messages.length - 1];
    elements.lobbyLastChat.textContent = last ? `${last.player}: ${last.message}` : "No messages yet.";
  } catch {
    elements.lobbyLastChat.textContent = "Chat unavailable.";
  }
}

async function sendLobbyChat(event) {
  event.preventDefault();
  const message = elements.lobbyChatInput.value.trim();
  if (!message) return;
  elements.lobbyChatInput.value = "";
  try {
    await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        room: "lobby",
        player: state.account ? shortAddress(state.account) : "guest",
        message
      })
    });
    await refreshLobbyChat();
  } catch {
    elements.lobbyLastChat.textContent = "Chat unavailable.";
  }
}

async function refreshTableChat() {
  try {
    const response = await fetch(`/api/chat?room=${encodeURIComponent(`table:${state.tableId}`)}`);
    if (!response.ok) return;
    const data = await response.json();
    const last = data.messages?.[data.messages.length - 1];
    elements.tableLastChat.textContent = last ? `${last.player}: ${last.message}` : "No messages yet.";
  } catch {
    elements.tableLastChat.textContent = "Chat unavailable.";
  }
}

async function sendTableChat(event) {
  event.preventDefault();
  const message = elements.tableChatInput.value.trim();
  if (!message) return;
  elements.tableChatInput.value = "";
  try {
    await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        room: `table:${state.tableId}`,
        player: state.account ? shortAddress(state.account) : "guest",
        message
      })
    });
    await refreshTableChat();
  } catch {
    elements.tableLastChat.textContent = "Chat unavailable.";
  }
}

function attachEvents() {
  if (!state.readContract || state.eventsAttached) return;
  state.eventsAttached = true;
  [
    "TableJoined",
    "TableCreated",
    "PlayerJoined",
    "TableReady",
    "PlayerConfirmed",
    "StageChanged",
    "StreetAntePaid",
    "SeedCommitted",
    "SeedRevealed",
    "HandSeedReady",
    "VrfSeedRequested",
    "VrfSeedFulfilled",
    "RevealTimedOut",
    "ActionSubmitted",
    "TableSettled",
    "HandFinished"
  ].forEach((eventName) => {
    state.readContract.on(eventName, (...args) => {
      const tableId = String(args[0]).toLowerCase();
      if (state.tableId && tableId === state.tableId.toLowerCase()) {
        refreshTable().catch((error) => console.info("event refresh skipped:", error.message));
      }
    });
  });
}

async function loadAdminState() {
  const token = adminToken();
  if (!token) {
    elements.adminStatus.textContent = "Enter ADMIN_TOKEN first.";
    elements.adminState.innerHTML = "";
    return;
  }

  try {
    const response = await fetch("/api/admin/state", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Admin state unavailable.");
    elements.adminStatus.textContent = data.waitingTableId
      ? `Unlocked. Waiting table: ${shortTableId(data.waitingTableId)}. Open it or join from lobby.`
      : "Unlocked. No waiting table right now.";
    renderAdminTables(data.tables || []);
  } catch (error) {
    elements.adminStatus.textContent = error.message || "Admin state unavailable.";
  }
}

async function adminAction(path) {
  const token = adminToken();
  if (!token) {
    elements.adminStatus.textContent = "Enter ADMIN_TOKEN first.";
    return;
  }

  try {
    elements.adminStatus.textContent = "Admin action pending...";
    const response = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Admin action failed.");
    const table = data.table;
    elements.adminStatus.textContent = table?.id
      ? `Done. Table ${shortTableId(table.id)} is ready. Use Open table to inspect or Join from lobby to sit as player.`
      : "Done.";
    await loadAdminState();
  } catch (error) {
    elements.adminStatus.textContent = error.message || "Admin action failed.";
  }
}

function adminToken() {
  const token = elements.adminTokenInput.value.trim();
  if (token) sessionStorage.setItem("pokerAdminToken", token);
  return token;
}

function renderAdminTables(tables) {
  elements.adminState.innerHTML = "";
  if (!tables.length) {
    const empty = document.createElement("div");
    empty.className = "admin-table-row";
    empty.innerHTML = "<strong>No tables yet.</strong><span>Create a bot table or add a bot to a human waiting in lobby.</span>";
    elements.adminState.append(empty);
    return;
  }

  for (const table of tables) {
    const row = document.createElement("div");
    row.className = "admin-table-row";
    const title = document.createElement("div");
    title.innerHTML = `<strong>${shortTableId(table.id)}</strong><br><span>${table.simulation ? "Bot test table" : "Human table"}</span>`;

    const meta = document.createElement("div");
    meta.className = "admin-table-meta";
    meta.innerHTML = `
      <div><span>Stage</span><strong>${table.stage || "--"}</strong></div>
      <div><span>Status</span><strong>${table.status || "--"}</strong></div>
      <div><span>Player 1</span><strong>${adminPlayerLabel(table.player1, table)}</strong></div>
      <div><span>Player 2</span><strong>${adminPlayerLabel(table.player2, table)}</strong></div>
    `;

    const actions = document.createElement("div");
    actions.className = "admin-table-actions";
    const open = document.createElement("button");
    open.className = "admin-open-button";
    open.type = "button";
    open.textContent = "Open table";
    open.addEventListener("click", () => {
      window.location.hash = `#/table/${table.id}`;
    });
    const lobby = document.createElement("button");
    lobby.className = "admin-lobby-button";
    lobby.type = "button";
    lobby.textContent = "Join from lobby";
    lobby.addEventListener("click", () => {
      window.location.hash = "";
    });
    actions.append(open, lobby);
    row.append(title, meta, actions);
    elements.adminState.append(row);
  }
}

function adminPlayerLabel(address, table) {
  if (!isAddress(address)) return "Waiting";
  const labels = table.playerLabels || {};
  return labels[address.toLowerCase()] || shortAddress(address);
}

async function saveMiniApp() {
  try {
    if (typeof state.sdk?.actions?.addMiniApp !== "function") return;
    await state.sdk.actions.addMiniApp();
  } catch (error) {
    showError(error.message || "Could not save Mini App.");
  }
}

async function shareMiniApp() {
  try {
    if (typeof state.sdk?.actions?.composeCast !== "function") return;
    await state.sdk.actions.composeCast({
      text: "I am waiting at a Poker Clash Base Sepolia table.",
      embeds: [CONFIG.appUrl || window.location.origin]
    });
  } catch (error) {
    showError(error.message || "Could not share Mini App.");
  }
}

async function verifyFairHand() {
  try {
    const fair = state.offchainTable?.fair || {};
    const player1 = state.offchainTable?.player1 || state.chainTable?.player1;
    const player2 = state.offchainTable?.player2 || state.chainTable?.player2;
    const handId = Number(fair.handId || currentHandId());
    const secret1 = fair.revealedSecrets?.player1 || "";
    const secret2 = fair.revealedSecrets?.player2 || "";
    if (!secret1 || !secret2 || !handId) {
      elements.fairVerifyStatus.textContent = "Both secrets are needed before verification.";
      return;
    }

    const commit1 = await buildSeedCommit(secret1, player1, state.tableId, handId);
    const commit2 = await buildSeedCommit(secret2, player2, state.tableId, handId);
    const commitsOk =
      commit1.toLowerCase() === String(fair.commits?.player1 || "").toLowerCase() &&
      commit2.toLowerCase() === String(fair.commits?.player2 || "").toLowerCase();

    const deck = deterministicDeck(fair.seed || "");
    const hash = await buildDeckHash(deck);
    const expectedSeed = await buildVrfSeed(secret1, secret2, state.tableId, handId, fair.vrfWord || "0");
    const seedOk = expectedSeed.toLowerCase() === String(fair.seed || "").toLowerCase();
    const deckOk = hash.toLowerCase() === String(fair.deckHash || "").toLowerCase();
    const publishedDeckOk = !fair.deck?.length || fair.deck.join("|") === deck.join("|");

    elements.fairVerifyStatus.textContent =
      commitsOk && seedOk && deckOk && publishedDeckOk
        ? "Verified: commits, Chainlink VRF seed, deck hash, and published deck match."
        : "Verification failed. Check commits, secrets, VRF word, seed, or deck hash.";
  } catch (error) {
    elements.fairVerifyStatus.textContent = error.message || "Verification failed.";
  }
}

async function getEthers() {
  if (!state.ethers) {
    state.ethers = await import("https://esm.sh/ethers@6.13.5");
  }
  return state.ethers;
}

async function buildSeedCommit(secret, playerAddress, tableId, handId) {
  const { keccak256, solidityPacked } = await getEthers();
  return keccak256(
    solidityPacked(
      ["string", "address", "bytes32", "uint256"],
      [secret, playerAddress, tableId, BigInt(handId)]
    )
  );
}

async function buildVrfSeed(secret1, secret2, tableId, handId, vrfWord) {
  const { keccak256, solidityPacked } = await getEthers();
  return keccak256(
    solidityPacked(
      ["string", "string", "bytes32", "uint256", "uint256", "uint256", "address"],
      [secret1, secret2, tableId, BigInt(handId), BigInt(vrfWord || 0), BigInt(BASE_CHAIN.id), CONTRACT_ADDRESS]
    )
  );
}

async function postFairAction(action, payload) {
  const response = await fetch(`/api/tables/${encodeURIComponent(state.tableId)}/fair/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ walletAddress: state.account, ...payload })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Provably fair state update failed.");
  state.offchainTable = data.table || state.offchainTable;
}

async function previousBlockHash(receipt) {
  try {
    const { BrowserProvider } = await getEthers();
    const provider = new BrowserProvider(state.provider);
    const blockNumber = Number(receipt?.blockNumber || 0);
    if (blockNumber > 0) {
      const block = await provider.getBlock(blockNumber - 1);
      if (block?.hash) return block.hash;
    }
  } catch {
    // Chain data is an extra seed input; fallback keeps local testing usable.
  }
  return `0x${"0".repeat(64)}`;
}

function parseEth(value) {
  const parseEther = state.ethers?.parseEther;
  if (!parseEther) throw new Error("Wallet library is not ready.");
  return parseEther(String(value || "0").trim() || "0");
}

function tableIdBytes() {
  if (!/^0x[a-fA-F0-9]{64}$/.test(state.tableId)) throw new Error("Bad table id.");
  return state.tableId;
}

function rememberLastTable(tableId) {
  if (!state.account || !/^0x[a-fA-F0-9]{64}$/.test(String(tableId || ""))) return;
  localStorage.setItem(lastTableKey(), tableId.toLowerCase());
}

function lastTableKey() {
  return `pokerActiveTable:${String(state.account || "").toLowerCase()}`;
}

function currentRouteTableId() {
  const match = window.location.hash.match(/^#\/table\/(0x[a-fA-F0-9]{64})$/);
  return match ? match[1].toLowerCase() : "";
}

function tableStatusText(stage, chain, offchain) {
  if (offchain?.simulation) {
    if (stage === "confirming") return "Bot test table. Start Bot Hand uses no blockchain transaction.";
    if (ACTIVE_STAGES.has(stage)) return sameAddress(offchain.turn, state.account) ? "Your turn against bot." : "Bot is thinking.";
    if (stage === "finished") return offchain.winner ? `Bot test finished. Winner: ${labelPlayer(offchain.winner)}.` : "Bot test finished.";
    return "Bot simulation mode. No bot transactions are sent.";
  }
  if (!isAddress(CONTRACT_ADDRESS)) return "Contract not configured.";
  if (!chain?.exists && !(offchain?.player1 && offchain?.player2)) return "Waiting for second player.";
  if (!chain?.exists) return "Both players are matched. Confirm your stake transaction.";
  if (stage === "waiting") return "Waiting for second player.";
  if (stage === "confirming") return "Both players must confirm within 60 seconds.";
  if (stage === "waiting_for_commit") return hasMyCommit() ? "Waiting for opponent commit." : "Commit your local seed.";
  if (stage === "waiting_for_reveal") return hasMyReveal() ? "Waiting for opponent reveal." : "Reveal your seed within 60 seconds.";
  if (stage === "waiting_for_vrf") return "Waiting for Chainlink VRF. Cards appear after the VRF callback.";
  if (stage === "seed_ready") return myStreetAntePaid(chain) ? "Waiting for opponent street ante." : "Pay street ante to start preflop.";
  if (ACTIVE_STAGES.has(stage) && chain?.turn === ZERO_ADDRESS) {
    return myStreetAntePaid(chain) ? "Waiting for opponent street ante." : `Pay street ante for ${stage}.`;
  }
  if (ACTIVE_STAGES.has(stage)) return sameAddress(chain.turn, state.account) ? "Your turn." : "Waiting for opponent.";
  if (stage === "showdown") return offchain?.winner ? `Suggested winner: ${labelAddress(offchain.winner)}.` : "Showdown result pending.";
  if (stage === "finished") return "Finished. Claim if you have a payout.";
  return "Ready.";
}

function labelAddress(address) {
  if (!isAddress(address) || address === ZERO_ADDRESS) return "--";
  return sameAddress(address, state.account) ? "You" : shortAddress(address);
}

function labelPlayer(address) {
  if (!isAddress(address) || address === ZERO_ADDRESS) return "--";
  const labels = state.offchainTable?.playerLabels || {};
  const botLabel = labels[address.toLowerCase()];
  if (botLabel) return botLabel;
  return labelAddress(address);
}

function turnLabel(address) {
  if (!isAddress(address) || address === ZERO_ADDRESS) return "--";
  return labelPlayer(address);
}

function myConfirmed(chain) {
  if (!chain || !state.account) return false;
  if (sameAddress(chain.player1, state.account)) return chain.confirmed1;
  if (sameAddress(chain.player2, state.account)) return chain.confirmed2;
  return false;
}

function myStreetAntePaid(chain) {
  if (!chain || !state.account) return false;
  if (sameAddress(chain.player1, state.account)) return chain.streetAntePaid1;
  if (sameAddress(chain.player2, state.account)) return chain.streetAntePaid2;
  return false;
}

function hasMyCommit() {
  const fair = state.offchainTable?.fair;
  if (!fair || !state.account) return false;
  if (sameAddress(state.offchainTable?.player1, state.account)) return Boolean(fair.commits?.player1);
  if (sameAddress(state.offchainTable?.player2, state.account)) return Boolean(fair.commits?.player2);
  return false;
}

function hasMyReveal() {
  const fair = state.offchainTable?.fair;
  if (!fair || !state.account) return false;
  if (sameAddress(state.offchainTable?.player1, state.account)) return Boolean(fair.revealedSecrets?.player1);
  if (sameAddress(state.offchainTable?.player2, state.account)) return Boolean(fair.revealedSecrets?.player2);
  return false;
}

function currentHandId() {
  return Number(state.chainTable?.handId || state.offchainTable?.handId || state.offchainTable?.fair?.handId || 0);
}

function isCurrentPlayer(chain) {
  return sameAddress(chain?.player1, state.account) || sameAddress(chain?.player2, state.account);
}

function sameAddress(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function shortAddress(address) {
  if (!isAddress(address)) return "--";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortTableId(tableId) {
  return `${tableId.slice(0, 8)}...${tableId.slice(-6)}`;
}

function shortTx(hash) {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function shortHash(hash) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(hash || "")) ? `${hash.slice(0, 8)}...${hash.slice(-6)}` : "--";
}

function shortSecret(secret) {
  const value = String(secret || "");
  if (!value) return "--";
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function getOrCreateHandSecret(handId) {
  const existing = readHandSecret(handId);
  if (existing) return existing;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  localStorage.setItem(handSecretKey(handId), secret);
  return secret;
}

function readHandSecret(handId) {
  return localStorage.getItem(handSecretKey(handId)) || "";
}

function handSecretKey(handId) {
  return `pokerFairSecret:${tableIdBytes()}:${handId}:${String(state.account || "").toLowerCase()}`;
}

function formatEth(value) {
  const formatter = state.ethers?.formatEther;
  if (!formatter) return "0 ETH";
  const raw = formatter(BigInt(value || 0));
  const [whole, fraction = ""] = raw.split(".");
  const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
  return `${trimmed ? `${whole}.${trimmed}` : whole} ETH`;
}

function formatCard(card) {
  const suit = card.slice(-1);
  const rank = card.slice(0, -1);
  return `${rank}${{ s: "\u2660", h: "\u2665", d: "\u2666", c: "\u2663" }[suit] || ""}`;
}

function cardSuit(card) {
  return card.endsWith("h") || card.endsWith("d") ? "red" : "black";
}

function deterministicDeck(seed) {
  const deck = [];
  const suits = ["s", "h", "d", "c"];
  const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
  for (const rank of ranks) {
    for (const suit of suits) deck.push(`${rank}${suit}`);
  }

  let hash = hashSeed(seed);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const j = hash % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function buildDeckHash(deck) {
  const { keccak256, toUtf8Bytes } = await getEthers();
  return keccak256(toUtf8Bytes((deck || []).join("|")));
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Wallet provider timed out")), timeoutMs);
    })
  ]);
}

function setBusy(busy, message = "") {
  state.busy = busy;
  if (message) {
    if (state.tableId) elements.tableStatus.textContent = message;
    else setLobbyStatus(message);
  }
  renderControls();
}

function setLobbyStatus(message) {
  elements.lobbyStatus.textContent = message;
}

function showError(message) {
  if (state.tableId) elements.tableStatus.textContent = message;
  else setLobbyStatus(message);
}

function walletError(error, fallback) {
  const message = String(error?.shortMessage || error?.message || error || "");
  if (error?.code === 4001 || message.toLowerCase().includes("user rejected")) return "Tx rejected.";
  if (message.toLowerCase().includes("chain")) return `Wrong network. Switch to ${BASE_CHAIN.name}.`;
  if (message.toLowerCase().includes("turn")) return "Not your turn.";
  if (message.toLowerCase().includes("timeout")) return "Timeout.";
  if (message.toLowerCase().includes("configured")) return "Contract not configured.";
  return message || fallback;
}
