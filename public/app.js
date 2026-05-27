const CONFIG = {
  appName: "Math Clash",
  appUrl: window.location.origin,
  escrowAddress: "",
  entryFeeLabel: "0.1",
  ethEntryFeeLabel: "0.0001",
  developerFeeBps: 400,
  chain: {
    id: 84532,
    hex: "0x14a34",
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia-explorer.base.org"
  },
  tokens: {
    ETH: "native",
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    USDT: ""
  },
  demoMode: true,
  ...(window.MATH_CLASH_CONFIG || {})
};

const BASE_CHAIN = {
  id: Number(CONFIG.chain?.id || 84532),
  hex: CONFIG.chain?.hex || `0x${Number(CONFIG.chain?.id || 84532).toString(16)}`,
  name: CONFIG.chain?.name || "Base Sepolia",
  rpcUrl: CONFIG.chain?.rpcUrl || "https://sepolia.base.org",
  explorerUrl: CONFIG.chain?.explorerUrl || "https://sepolia-explorer.base.org"
};

const TOKENS = {
  ETH: {
    symbol: "ETH",
    address: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    native: true
  },
  USDC: {
    symbol: "USDC",
    address: CONFIG.tokens?.USDC || "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6
  },
  USDT: {
    symbol: "USDT",
    address: CONFIG.tokens?.USDT || "",
    decimals: 6
  }
};

const ENTRY_UNITS = 100000n;
const NATIVE_ENTRY_UNITS = 100000000000000n;
const BPS_DENOMINATOR = 10000n;
const DEVELOPER_FEE_BPS = BigInt(CONFIG.developerFeeBps || 400);

const ERC20_ABI = ["function approve(address spender, uint256 value) external returns (bool)"];
const ESCROW_ABI = ["function deposit(bytes32 matchId, address token) external"];

const state = {
  sdk: null,
  provider: null,
  ethers: null,
  account: null,
  selectedToken: "ETH",
  difficulty: "medium",
  match: null,
  playerId: null,
  currentIndex: 0,
  questionStartedAt: 0,
  localScore: 0,
  timerId: null,
  pollId: null,
  busy: false
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  connectWallet: $("#connectWallet"),
  tokenControls: $("#tokenControls"),
  difficultyControls: $("#difficultyControls"),
  payAndPlay: $("#payAndPlay"),
  demoPlay: $("#demoPlay"),
  paymentStatus: $("#paymentStatus"),
  tokenLabel: $("#tokenLabel"),
  entryFeeLabel: $("#entryFeeLabel"),
  timer: $("#timer"),
  score: $("#score"),
  matchStatus: $("#matchStatus"),
  question: $("#question"),
  answerForm: $("#answerForm"),
  answerInput: $("#answerInput"),
  submitAnswer: $("#submitAnswer"),
  playerName: $("#playerName"),
  playerMeta: $("#playerMeta"),
  rivalName: $("#rivalName"),
  rivalMeta: $("#rivalMeta"),
  statMatches: $("#statMatches"),
  statWins: $("#statWins"),
  statBest: $("#statBest"),
  statAccuracy: $("#statAccuracy"),
  leaderboard: $("#leaderboard"),
  refreshLeaderboard: $("#refreshLeaderboard")
};

boot();

async function boot() {
  updateSelectedTokenLabels();
  bindEvents();
  refreshPaymentControls();
  await initMiniApp();
  await loadLeaderboard();
}

function bindEvents() {
  elements.connectWallet.addEventListener("click", connectWallet);
  elements.payAndPlay.addEventListener("click", payAndPlay);
  elements.demoPlay.addEventListener("click", () => joinArena({ demo: true, txHash: "" }));
  elements.refreshLeaderboard.addEventListener("click", loadLeaderboard);

  elements.tokenControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-token]");
    if (!button || state.match?.status === "active") return;
    state.selectedToken = button.dataset.token;
    updateSegments(elements.tokenControls, button);
    updateSelectedTokenLabels();
    refreshPaymentControls();
  });

  elements.difficultyControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-difficulty]");
    if (!button || state.match?.status === "active") return;
    state.difficulty = button.dataset.difficulty;
    updateSegments(elements.difficultyControls, button);
  });

  elements.answerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitCurrentAnswer();
  });
}

async function initMiniApp() {
  try {
    const module = await import("https://esm.sh/@farcaster/miniapp-sdk");
    state.sdk = module.sdk;
    await state.sdk.actions.ready();
  } catch (error) {
    console.info("Farcaster SDK not available in this environment:", error.message);
  }
}

async function connectWallet() {
  setStatus("Connecting wallet...");
  try {
    state.provider = await getWalletProvider();
    if (!state.provider) {
      setStatus("No wallet provider found.");
      return;
    }

    const accounts = await requestAccounts(state.provider);
    state.account = accounts[0];
    localStorage.setItem("math-clash:last-wallet", state.account);
    elements.connectWallet.textContent = shortAddress(state.account);
    setStatus("Wallet connected.");
    refreshPaymentControls();
    await loadStats();
  } catch (error) {
    setStatus(getWalletErrorMessage(error, "Wallet connection failed."));
  }
}

async function getWalletProvider() {
  const injectedProvider = await getInjectedWalletProvider();
  if (injectedProvider) return injectedProvider;

  if (state.sdk?.wallet?.getEthereumProvider) {
    try {
      return await state.sdk.wallet.getEthereumProvider();
    } catch (error) {
      console.info("Mini App wallet unavailable:", error.message);
    }
  }
  return window.ethereum || null;
}

async function requestAccounts(provider) {
  if (!provider?.request) {
    throw new Error("Selected wallet provider does not support requests.");
  }

  const existing = await provider.request({ method: "eth_accounts" }).catch(() => []);
  if (existing.length) return existing;
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) {
    throw new Error("No account returned by wallet.");
  }
  return accounts;
}

async function payAndPlay() {
  if (state.busy) return;

  try {
    state.busy = true;
    refreshPaymentControls();

    if (!isUsableEscrow()) {
      setStatus("Set escrowAddress in public/config.js first.");
      return;
    }

    if (!isSelectedTokenConfigured()) {
      setStatus(`${state.selectedToken} is not configured for ${BASE_CHAIN.name}.`);
      return;
    }

    if (!state.account) {
      await connectWallet();
    }

    if (!state.provider || !state.account) {
      setStatus("Connect a wallet before entering.");
      return;
    }

    await ensureBaseChain(state.provider);
    const token = TOKENS[state.selectedToken];

    if (!token.native) {
      setStatus(`Approving ${getEntryFeeLabel(token.symbol)} ${token.symbol} for escrow...`);
      const approveTxHash = await approveEscrow(state.provider, state.account, token);
      setStatus(`Waiting for approval confirmation: ${shortTx(approveTxHash)}...`);
      await waitForTransactionSuccess(state.provider, approveTxHash);
    }

    setStatus("Reserving a match...");
    const reservation = await reservePaidMatch();

    setStatus("Depositing entry into escrow...");
    const txHash = await depositEntry(state.provider, state.account, token, reservation.payment.escrowId);
    setStatus(`Waiting for escrow confirmation: ${shortTx(txHash)}...`);
    await waitForTransactionSuccess(state.provider, txHash);
    setStatus(`Escrow funded: ${shortTx(txHash)}.`);
    await joinArena({ demo: false, txHash, reservation });
  } catch (error) {
    setStatus(getWalletErrorMessage(error, "Payment failed."));
  } finally {
    state.busy = false;
    refreshPaymentControls();
  }
}

async function getInjectedWalletProvider() {
  const candidates = await discoverInjectedProviders();
  if (!candidates.length) return null;

  const rabby = candidates.find(({ provider, info }) => {
    const name = `${info?.name || ""} ${info?.rdns || ""}`.toLowerCase();
    return provider?.isRabby || name.includes("rabby");
  });
  if (rabby) return rabby.provider;

  const browserWallet = candidates.find(({ provider }) => provider?.request);
  return browserWallet?.provider || null;
}

async function discoverInjectedProviders() {
  const candidates = [];
  const seen = new Set();

  const addCandidate = (provider, info = null) => {
    if (!provider || seen.has(provider)) return;
    seen.add(provider);
    candidates.push({ provider, info });
  };

  addCandidate(window.rabby, { name: "Rabby" });

  if (window.ethereum?.providers?.length) {
    window.ethereum.providers.forEach((provider) => addCandidate(provider));
  }
  addCandidate(window.ethereum);

  if (typeof window.addEventListener === "function" && typeof window.dispatchEvent === "function") {
    const onProvider = (event) => {
      addCandidate(event.detail?.provider, event.detail?.info);
    };

    window.addEventListener("eip6963:announceProvider", onProvider);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, 250));
    window.removeEventListener("eip6963:announceProvider", onProvider);
  }

  return candidates.filter(({ provider }) => provider?.request);
}

function getWalletErrorMessage(error, fallback) {
  const message = String(error?.message || error || "");
  if (error?.code === 4001 || message.toLowerCase().includes("user rejected")) {
    return "Wallet request rejected.";
  }
  if (message.includes("Cannot read properties of undefined")) {
    return "Wallet provider failed. Refresh the page and try Rabby again.";
  }
  return message || fallback;
}

async function approveEscrow(provider, from, token) {
  return sendContractCall({
    provider,
    from,
    to: token.address,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [CONFIG.escrowAddress, ENTRY_UNITS]
  });
}

async function depositEntry(provider, from, token, escrowId) {
  return sendContractCall({
    provider,
    from,
    to: CONFIG.escrowAddress,
    abi: ESCROW_ABI,
    functionName: "deposit",
    args: [escrowId, token.address],
    value: token.native ? toHexQuantity(getEntryUnits(token.symbol)) : "0x0"
  });
}

async function sendContractCall({ provider, from, to, abi, functionName, args, value = "0x0" }) {
  const { Interface } = await getEthers();
  const iface = new Interface(abi);
  const data = iface.encodeFunctionData(functionName, args);
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to, value, data }]
  });
}

async function waitForTransactionSuccess(provider, txHash) {
  const receipt = await waitForTransactionReceipt(provider, txHash);
  const status = normalizeHexQuantity(receipt?.status);
  if (status !== "0x1") {
    throw new Error(`Transaction failed: ${shortTx(txHash)}.`);
  }
  return receipt;
}

async function waitForTransactionReceipt(provider, txHash) {
  const startedAt = Date.now();
  const timeoutMs = 120000;

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await provider
      .request({
        method: "eth_getTransactionReceipt",
        params: [txHash]
      })
      .catch(() => null);

    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }

  throw new Error(`Transaction still pending: ${shortTx(txHash)}.`);
}

async function getEthers() {
  if (!state.ethers) {
    state.ethers = await import("https://esm.sh/ethers@6.13.5");
  }
  return state.ethers;
}

async function ensureBaseChain(provider) {
  const chainId = await provider.request({ method: "eth_chainId" });
  if (chainId?.toLowerCase() === BASE_CHAIN.hex) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN.hex }]
    });
  } catch (switchError) {
    if (switchError.code !== 4902) {
      throw switchError;
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: BASE_CHAIN.hex,
          chainName: BASE_CHAIN.name,
          nativeCurrency: {
            name: "Ether",
            symbol: "ETH",
            decimals: 18
          },
          rpcUrls: [BASE_CHAIN.rpcUrl],
          blockExplorerUrls: [BASE_CHAIN.explorerUrl]
        }
      ]
    });
  }
}

async function reservePaidMatch() {
  const wallet = state.account;
  return api("/api/matches/reserve", {
    method: "POST",
    body: {
      wallet,
      difficulty: state.difficulty,
      token: state.selectedToken
    }
  });
}

async function joinArena({ demo, txHash, reservation = null }) {
  clearMatchLoops();
  state.currentIndex = 0;
  state.localScore = 0;
  elements.score.textContent = "0";
  setQuestion("Ready?");
  setStatus(demo ? "Finding a demo rival..." : "Finding a rival...");

  const wallet = state.account || getGuestWallet();
  const response = await api("/api/matches/join", {
    method: "POST",
    body: {
      wallet,
      matchId: reservation?.matchId,
      playerId: reservation?.playerId,
      escrowId: reservation?.payment?.escrowId,
      difficulty: state.difficulty,
      token: state.selectedToken,
      txHash,
      demo
    }
  });

  applyMatch(response);
  startPolling();
}

async function submitCurrentAnswer() {
  const match = state.match;
  if (!match || match.status !== "active") return;

  const answer = elements.answerInput.value.trim();
  if (!answer) return;

  const ms = Date.now() - state.questionStartedAt;
  elements.answerInput.value = "";
  elements.submitAnswer.disabled = true;

  const response = await api(`/api/matches/${match.matchId}/answer`, {
    method: "POST",
    body: {
      playerId: state.playerId,
      index: state.currentIndex,
      answer: Number(answer),
      ms
    }
  });

  applyMatch(response.match);
}

function applyMatch(match) {
  const previousStatus = state.match?.status;
  const previousIndex = state.currentIndex;

  state.match = match;
  state.playerId = match.playerId || state.playerId;

  const me = getMe();
  const rival = getRival();

  if (me) {
    state.localScore = me.score;
    elements.score.textContent = String(me.score);
    elements.playerName.textContent = me.name || "You";
    elements.playerMeta.textContent = `${me.answered} solved / ${me.correct} correct`;
  }

  if (rival) {
    elements.rivalName.textContent = rival.name || "Rival";
    elements.rivalMeta.textContent = `${rival.answered} solved / ${rival.correct} correct`;
  } else {
    elements.rivalName.textContent = "Waiting";
    elements.rivalMeta.textContent = "0 solved";
  }

  if (match.status === "waiting") {
    setStatus("Waiting for a rival...");
    setQuestion("Matchmaking");
    toggleAnswer(false);
  }

  if (match.status === "funding") {
    const paid = me?.paid ? "Rival is funding escrow..." : "Funding escrow...";
    setStatus(paid);
    setQuestion("Escrow");
    toggleAnswer(false);
  }

  if (match.status === "active") {
    const nextIndex = me ? me.answered : state.currentIndex;
    const shouldRenderQuestion =
      previousStatus !== "active" ||
      nextIndex !== previousIndex ||
      elements.question.textContent === "Matchmaking" ||
      elements.question.textContent === "Ready?";
    state.currentIndex = nextIndex;
    if (shouldRenderQuestion) {
      renderQuestion();
    }
    toggleAnswer(true);
    setStatus("Clash live.");
    if (!state.timerId) {
      startTimer();
    }
  }

  if (match.status === "finished") {
    renderResult();
    toggleAnswer(false);
    clearMatchLoops();
    loadLeaderboard();
    loadStats();
  }
}

function renderQuestion() {
  const match = state.match;
  if (!match || match.status !== "active") return;

  if (state.currentIndex >= match.questions.length) {
    setQuestion("Done");
    setStatus("Waiting for result...");
    toggleAnswer(false);
    finishMatch();
    return;
  }

  const question = match.questions[state.currentIndex];
  setQuestion(question.expression.replace("*", "x"));
  state.questionStartedAt = Date.now();
  elements.submitAnswer.disabled = false;
  elements.answerInput.disabled = false;
  elements.answerInput.focus({ preventScroll: true });
}

function renderResult() {
  const match = state.match;
  const me = getMe();

  let line = "Draw.";
  if (match.result?.winnerId) {
    line = match.result.winnerId === state.playerId ? "You won." : "Rival won.";
  }

  if (match.payment?.mode === "escrow" && match.payment.payout) {
    if (match.payment.payout.draw) {
      line += ` Escrow refunds ${match.payment.payout.entryFee || getEntryFeeLabel(match.payment.token)} ${match.payment.token} to each player.`;
    } else if (match.result?.winnerId === state.playerId) {
      line += ` Payout: ${match.payment.payout.winnerPayout} ${match.payment.token}.`;
    } else {
      line += ` Winner payout: ${match.payment.payout.winnerPayout} ${match.payment.token}.`;
    }

    const settlement = match.payment.settlement;
    if (settlement?.txHash) {
      line += ` Settlement ${shortTx(settlement.txHash)}.`;
    } else if (settlement?.status === "failed") {
      line += " Settlement failed; resolver needs attention.";
    } else if (settlement?.status === "resolver_not_configured") {
      line += " Settlement not sent; resolver is not configured.";
    } else if (settlement?.status === "submitting") {
      line += " Settlement submitting...";
    } else if (settlement?.status === "not_started") {
      line += " Settlement pending.";
    }
  }

  setStatus(line);
  setQuestion(me ? `${me.score} pts` : "Finished");
  elements.timer.textContent = "0s";
}

async function finishMatch() {
  const match = state.match;
  if (!match) return;
  const response = await api(`/api/matches/${match.matchId}/finish`, {
    method: "POST",
    body: { playerId: state.playerId }
  });
  applyMatch(response);
}

function startPolling() {
  clearInterval(state.pollId);
  state.pollId = window.setInterval(async () => {
    if (!state.match || state.match.status === "finished") return;
    const response = await api(`/api/matches/${state.match.matchId}?playerId=${state.playerId}`);
    applyMatch(response);
  }, 1000);
}

function startTimer() {
  clearInterval(state.timerId);
  updateTimer();
  state.timerId = window.setInterval(updateTimer, 250);
}

function updateTimer() {
  const match = state.match;
  if (!match?.startedAt) {
    elements.timer.textContent = "--";
    return;
  }
  const elapsed = Date.now() - match.startedAt;
  const left = Math.max(0, Math.ceil(match.durationSec - elapsed / 1000));
  elements.timer.textContent = `${left}s`;
  if (left <= 0) {
    toggleAnswer(false);
  }
}

async function loadLeaderboard() {
  const response = await api("/api/leaderboard");
  elements.leaderboard.innerHTML = "";

  if (!response.leaderboard.length) {
    const empty = document.createElement("li");
    empty.innerHTML = `<span class="rank">-</span><span class="name">No ranked matches yet</span><span class="points">0</span>`;
    elements.leaderboard.append(empty);
    return;
  }

  response.leaderboard.forEach((row) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <span class="rank">${row.rank}</span>
      <span class="name">${escapeHtml(row.display)} - ${row.wins}W - ${row.accuracy}%</span>
      <span class="points">${row.score}</span>
    `;
    elements.leaderboard.append(item);
  });
}

async function loadStats() {
  const wallet = state.account || localStorage.getItem("math-clash:last-wallet");
  if (!wallet) return;

  const response = await api(`/api/stats/${encodeURIComponent(wallet)}`);
  const stats = response.stats;
  const accuracy = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0;
  elements.statMatches.textContent = String(stats.matches);
  elements.statWins.textContent = String(stats.wins);
  elements.statBest.textContent = String(stats.bestScore);
  elements.statAccuracy.textContent = `${accuracy}%`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function updateSegments(container, activeButton) {
  container.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("active", button === activeButton);
  });
}

function refreshPaymentControls() {
  const hasEscrow = isUsableEscrow();
  const hasToken = isSelectedTokenConfigured();
  elements.payAndPlay.disabled = state.busy || !hasEscrow || !hasToken;
  elements.demoPlay.hidden = !CONFIG.demoMode;

  if (!hasEscrow) {
    elements.paymentStatus.textContent = "Escrow not configured.";
  } else if (!hasToken) {
    elements.paymentStatus.textContent = `${state.selectedToken} token not configured for ${BASE_CHAIN.name}.`;
  } else if (!state.account) {
    elements.paymentStatus.textContent = `Winner gets ${getWinnerPayoutLabel(state.selectedToken)} ${state.selectedToken} on ${BASE_CHAIN.name}; developer fee ${getDeveloperFeeLabel(state.selectedToken)}.`;
  } else {
    elements.paymentStatus.textContent = `Ready with ${shortAddress(state.account)}. Winner payout ${getWinnerPayoutLabel(state.selectedToken)} ${state.selectedToken}.`;
  }
}

function toggleAnswer(enabled) {
  elements.answerInput.disabled = !enabled;
  elements.submitAnswer.disabled = !enabled;
}

function setStatus(message) {
  elements.matchStatus.textContent = message;
}

function setQuestion(message) {
  elements.question.textContent = message;
}

function getMe() {
  return state.match?.players.find((player) => player.id === state.playerId) || null;
}

function getRival() {
  return state.match?.players.find((player) => player.id !== state.playerId) || null;
}

function clearMatchLoops() {
  clearInterval(state.timerId);
  clearInterval(state.pollId);
  state.timerId = null;
  state.pollId = null;
}

function isUsableEscrow() {
  return /^0x[a-fA-F0-9]{40}$/.test(CONFIG.escrowAddress) && !/^0x0{40}$/i.test(CONFIG.escrowAddress);
}

function isSelectedTokenConfigured() {
  const token = TOKENS[state.selectedToken];
  if (!token) return false;
  return token.native || /^0x[a-fA-F0-9]{40}$/.test(token.address || "");
}

function updateSelectedTokenLabels() {
  elements.entryFeeLabel.textContent = getEntryFeeLabel(state.selectedToken);
  elements.tokenLabel.textContent = state.selectedToken;
}

function getEntryUnits(symbol) {
  return TOKENS[symbol]?.native ? NATIVE_ENTRY_UNITS : ENTRY_UNITS;
}

function getTokenDecimals(symbol) {
  return TOKENS[symbol]?.decimals || 6;
}

function getEntryFeeLabel(symbol) {
  if (TOKENS[symbol]?.native) return CONFIG.ethEntryFeeLabel || formatTokenUnits(NATIVE_ENTRY_UNITS, 18);
  return CONFIG.entryFeeLabel || formatTokenUnits(ENTRY_UNITS, 6);
}

function getWinnerPayoutLabel(symbol) {
  const pot = getEntryUnits(symbol) * 2n;
  const developerFee = (pot * DEVELOPER_FEE_BPS) / BPS_DENOMINATOR;
  return formatTokenUnits(pot - developerFee, getTokenDecimals(symbol));
}

function getDeveloperFeeLabel(symbol) {
  const pot = getEntryUnits(symbol) * 2n;
  return formatTokenUnits((pot * DEVELOPER_FEE_BPS) / BPS_DENOMINATOR, getTokenDecimals(symbol));
}

function formatTokenUnits(units, decimals = 6) {
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fraction = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function toHexQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function getGuestWallet() {
  const existing = localStorage.getItem("math-clash:guest");
  if (existing) return existing;
  const value = `guest:${cryptoRandomId()}`;
  localStorage.setItem("math-clash:guest", value);
  return value;
}

function cryptoRandomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function shortAddress(address) {
  if (!address) return "Connect";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortTx(txHash) {
  if (!txHash) return "tx";
  return `${txHash.slice(0, 10)}...${txHash.slice(-6)}`;
}

function normalizeHexQuantity(value) {
  if (typeof value === "number") return `0x${value.toString(16)}`;
  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  if (typeof value === "string") return value.toLowerCase();
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
