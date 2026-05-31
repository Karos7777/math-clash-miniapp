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
const STAGES = ["waiting", "confirming", "preflop", "flop", "turn", "river", "showdown", "finished"];
const ACTIVE_STAGES = new Set(["preflop", "flop", "turn", "river"]);
const CONTRACT_ABI = [
  "function joinTable(bytes32 tableId) payable",
  "function confirm(bytes32 tableId)",
  "function check(bytes32 tableId)",
  "function bet(bytes32 tableId) payable",
  "function call(bytes32 tableId) payable",
  "function fold(bytes32 tableId)",
  "function timeout(bytes32 tableId)",
  "function submitResult(bytes32 tableId,address winner)",
  "function claimWinnings()",
  "function getTable(bytes32 tableId) view returns (tuple(bool exists,address player1,address player2,uint256 stake,uint256 pot,uint8 stage,address turn,uint256 actionDeadline,uint256 currentBet,uint8 actionsThisStage,bool confirmed1,bool confirmed2,address winner,bool refunded))",
  "function pendingWithdrawals(address) view returns (uint256)",
  "function defaultStake() view returns (uint256)",
  "event TableJoined(bytes32 indexed tableId, address indexed player, uint256 stake)",
  "event TableReady(bytes32 indexed tableId, address indexed player1, address indexed player2, uint256 pot)",
  "event PlayerConfirmed(bytes32 indexed tableId, address indexed player)",
  "event StageChanged(bytes32 indexed tableId, uint8 stage, address turn, uint256 actionDeadline)",
  "event PlayerChecked(bytes32 indexed tableId, address indexed player)",
  "event PlayerBet(bytes32 indexed tableId, address indexed player, uint256 amount)",
  "event PlayerCalled(bytes32 indexed tableId, address indexed player, uint256 amount)",
  "event PlayerFolded(bytes32 indexed tableId, address indexed player, address indexed winner)",
  "event PlayerTimedOut(bytes32 indexed tableId, address indexed inactivePlayer, address indexed winner)",
  "event TableSettled(bytes32 indexed tableId, address indexed winner, uint256 payout, uint256 developerFee)"
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
  readContract: null,
  writeContract: null,
  tableId: "",
  offchainTable: null,
  chainTable: null,
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
  connectWallet: $("#connectWallet"),
  lobbyScreen: $("#lobbyScreen"),
  tableScreen: $("#tableScreen"),
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
  tableChatInput: $("#tableChatInput")
};

boot().catch((error) => showError(error.message || "App failed to start."));

async function boot() {
  elements.lobbyStake.textContent = `${CONFIG.defaultStakeEth || "0.0001"} ETH`;
  elements.lobbyNetwork.textContent = BASE_CHAIN.name;
  elements.lobbyContract.textContent = isAddress(CONTRACT_ADDRESS) ? shortAddress(CONTRACT_ADDRESS) : "Not configured";
  elements.betInput.value = CONFIG.defaultBetEth || "0.00001";
  bindEvents();
  renderRoute();
  initMiniApp().catch((error) => console.info("Mini App init skipped:", error.message));
  await initReadContract();
  refreshWalletFromProvider().catch(() => {});
  startPolling();
}

function bindEvents() {
  window.addEventListener("hashchange", renderRoute);
  elements.connectWallet.addEventListener("click", connectWallet);
  elements.startGameButton.addEventListener("click", startGame);
  elements.backToLobbyButton.addEventListener("click", () => {
    window.location.hash = "";
  });
  elements.saveMiniApp.addEventListener("click", saveMiniApp);
  elements.shareMiniApp.addEventListener("click", shareMiniApp);
  elements.confirmButton.addEventListener("click", confirmOrJoin);
  elements.checkButton.addEventListener("click", () => sendTableTx("check", () => state.writeContract.check(tableIdBytes())));
  elements.betButton.addEventListener("click", bet);
  elements.callButton.addEventListener("click", callBet);
  elements.foldButton.addEventListener("click", () => sendTableTx("fold", () => state.writeContract.fold(tableIdBytes())));
  elements.timeoutButton.addEventListener("click", () => sendTableTx("timeout", () => state.writeContract.timeout(tableIdBytes())));
  elements.settleButton.addEventListener("click", settleShowdown);
  elements.claimButton.addEventListener("click", () => sendTableTx("claim", () => state.writeContract.claimWinnings()));
  elements.lobbyChatForm.addEventListener("submit", sendLobbyChat);
  elements.tableChatForm.addEventListener("submit", sendTableChat);
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
  const tableId = currentRouteTableId();
  state.tableId = tableId;
  document.body.classList.toggle("table-route", Boolean(tableId));
  elements.lobbyScreen.hidden = Boolean(tableId);
  elements.tableScreen.hidden = !tableId;

  if (tableId) {
    elements.tableIdLabel.textContent = shortTableId(tableId);
    refreshTable();
  } else {
    state.tableId = "";
    state.offchainTable = null;
    state.chainTable = null;
    refreshLobbyChat();
    renderControls();
  }
}

async function connectWallet() {
  try {
    state.provider = await getWalletProvider();
    if (!state.provider?.request) {
      setLobbyStatus("Open in Farcaster/Base app or a browser with Rabby/Coinbase Wallet.");
      return;
    }

    const accounts = await requestAccounts(state.provider);
    state.account = accounts[0];
    elements.connectWallet.textContent = shortAddress(state.account);
    await ensureBaseChain(state.provider);

    if (isAddress(CONTRACT_ADDRESS)) {
      const { BrowserProvider, Contract } = await getEthers();
      const browserProvider = new BrowserProvider(state.provider);
      const signer = await browserProvider.getSigner();
      state.writeContract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    }

    setLobbyStatus("Wallet connected.");
    renderControls();
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
    if (isAddress(CONTRACT_ADDRESS)) {
      const { BrowserProvider, Contract } = await getEthers();
      const browserProvider = new BrowserProvider(state.provider);
      const signer = await browserProvider.getSigner();
      state.writeContract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    }
  }
  renderControls();
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
    window.location.hash = `#/table/${data.table.id}`;
  } catch (error) {
    showError(error.message || "Lobby unavailable.");
  } finally {
    setBusy(false);
  }
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
    state.chainTable = {
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
      winner: table.winner,
      refunded: Boolean(table.refunded)
    };
  } catch (error) {
    console.info("Contract table read failed:", error.message);
    state.chainTable = null;
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
  const stage = chain.exists ? chain.stage : offchain.stage || "waiting";
  const player1 = chain.exists ? chain.player1 : offchain.player1 || "";
  const player2 = chain.exists ? chain.player2 : offchain.player2 || "";
  const pot = chain.exists ? formatEth(chain.pot || 0n) : "0 ETH";
  const stake = chain.exists && chain.stake ? formatEth(chain.stake) : `${CONFIG.defaultStakeEth || "0.0001"} ETH`;

  elements.player1Label.textContent = player1 ? labelAddress(player1) : "Waiting";
  elements.player2Label.textContent = player2 ? labelAddress(player2) : "Waiting";
  elements.potLabel.textContent = pot;
  elements.stakeLabel.textContent = `${stake} stake`;
  elements.stageLabel.textContent = stage;
  elements.turnLabel.textContent = turnLabel(chain.turn);
  elements.tableStatus.textContent = tableStatusText(stage, chain, offchain);
  renderCards(elements.playerCards, offchain.playerCards || [], true);
  renderCards(elements.communityCards, offchain.communityCards || [], false);
  renderControls();
  renderTimer();
}

function renderControls() {
  const connected = Boolean(state.account);
  const contractConfigured = isAddress(CONTRACT_ADDRESS);
  const chain = state.chainTable;
  const stage = chain?.stage || "waiting";
  const isPlayer = chain?.exists && isCurrentPlayer(chain);
  const joined = isPlayer;
  const offchainReady = Boolean(state.offchainTable?.player1 && state.offchainTable?.player2);
  const needsJoin = state.tableId && offchainReady && (!chain?.exists || !joined);
  const needsConfirm = joined && stage === "confirming" && !myConfirmed(chain);
  const myTurn = joined && sameAddress(chain?.turn, state.account);
  const timedOut = Boolean(chain?.actionDeadline && Date.now() / 1000 > chain.actionDeadline);
  const canAct = ACTIVE_STAGES.has(stage) && myTurn && !timedOut;
  const canCall = canAct && BigInt(chain?.currentBet || 0) > 0n;
  const canSettle = stage === "showdown" && joined && Boolean(state.offchainTable?.winner);
  const canClaim = state.pendingClaim > 0n;

  elements.startGameButton.disabled = state.busy || !connected;
  elements.confirmButton.hidden = !(needsJoin || needsConfirm);
  elements.checkButton.hidden = !(canAct && !canCall);
  elements.betField.hidden = !canAct;
  elements.betButton.hidden = !(canAct && !canCall);
  elements.callButton.hidden = !canCall;
  elements.foldButton.hidden = !canAct;
  elements.timeoutButton.hidden = !(joined && timedOut && stage !== "finished");
  elements.settleButton.hidden = !canSettle;
  elements.claimButton.hidden = !canClaim;

  elements.confirmButton.textContent = needsJoin ? "Confirm Stake" : "Confirm";
  elements.confirmButton.disabled = state.busy || !connected || !contractConfigured;
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

async function confirmOrJoin() {
  if (!state.chainTable?.exists || !isCurrentPlayer(state.chainTable)) {
    const value = parseEth(CONFIG.defaultStakeEth || "0.0001");
    await sendTableTx("confirm stake", () => state.writeContract.joinTable(tableIdBytes(), { value }));
    return;
  }
  await sendTableTx("confirm", () => state.writeContract.confirm(tableIdBytes()));
}

async function bet() {
  const value = parseEth(elements.betInput.value || CONFIG.defaultBetEth || "0.00001");
  await sendTableTx("bet", () => state.writeContract.bet(tableIdBytes(), { value }));
}

async function callBet() {
  const value = BigInt(state.chainTable?.currentBet || 0);
  if (value <= 0n) {
    showError("No open bet to call.");
    return;
  }
  await sendTableTx("call", () => state.writeContract.call(tableIdBytes(), { value }));
}

async function settleShowdown() {
  const winner = state.offchainTable?.winner;
  if (!isAddress(winner)) {
    showError("Off-chain winner is not ready yet.");
    return;
  }
  await sendTableTx("settle", () => state.writeContract.submitResult(tableIdBytes(), winner));
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
  if (!state.writeContract) {
    await connectWallet();
  }
  if (!state.writeContract) {
    throw new Error("Contract not ready.");
  }
  await ensureBaseChain(state.provider);
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
    if (switchError.code !== 4902) throw new Error(`Wrong network. Switch to ${BASE_CHAIN.name}.`);
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
  ["TableJoined", "TableReady", "PlayerConfirmed", "StageChanged", "TableSettled"].forEach((eventName) => {
    state.readContract.on(eventName, (...args) => {
      const tableId = String(args[0]).toLowerCase();
      if (state.tableId && tableId === state.tableId.toLowerCase()) {
        refreshTable().catch((error) => console.info("event refresh skipped:", error.message));
      }
    });
  });
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

async function getEthers() {
  if (!state.ethers) {
    state.ethers = await import("https://esm.sh/ethers@6.13.5");
  }
  return state.ethers;
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

function currentRouteTableId() {
  const match = window.location.hash.match(/^#\/table\/(0x[a-fA-F0-9]{64})$/);
  return match ? match[1].toLowerCase() : "";
}

function tableStatusText(stage, chain, offchain) {
  if (!isAddress(CONTRACT_ADDRESS)) return "Contract not configured.";
  if (!chain?.exists && !(offchain?.player1 && offchain?.player2)) return "Waiting for second player.";
  if (!chain?.exists) return "Both players are matched. Confirm your stake transaction.";
  if (stage === "waiting") return "Waiting for second player.";
  if (stage === "confirming") return "Both players must confirm within 60 seconds.";
  if (ACTIVE_STAGES.has(stage)) return sameAddress(chain.turn, state.account) ? "Your turn." : "Waiting for opponent.";
  if (stage === "showdown") return offchain?.winner ? `Suggested winner: ${labelAddress(offchain.winner)}.` : "Showdown result pending.";
  if (stage === "finished") return "Finished. Claim if you have a payout.";
  return "Ready.";
}

function labelAddress(address) {
  if (!isAddress(address) || address === ZERO_ADDRESS) return "--";
  return sameAddress(address, state.account) ? "You" : shortAddress(address);
}

function turnLabel(address) {
  if (!isAddress(address) || address === ZERO_ADDRESS) return "--";
  return sameAddress(address, state.account) ? "You" : shortAddress(address);
}

function myConfirmed(chain) {
  if (!chain || !state.account) return false;
  if (sameAddress(chain.player1, state.account)) return chain.confirmed1;
  if (sameAddress(chain.player2, state.account)) return chain.confirmed2;
  return false;
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
