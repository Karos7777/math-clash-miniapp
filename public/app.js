const CONFIG = {
  appName: "Brain Clash",
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
const DEFAULT_QUIZ_CATEGORIES = [
  { id: "crypto", label: "Crypto" },
  { id: "gaming", label: "Gaming" },
  { id: "logic", label: "Logic" },
  { id: "culture", label: "Culture" }
];

const ERC20_ABI = ["function approve(address spender, uint256 value) external returns (bool)"];
const ESCROW_ABI = [
  "function deposit(bytes32 matchId, address token) external",
  "function cancelUnmatched(bytes32 matchId) external"
];

const state = {
  sdk: null,
  fid: null,
  username: "",
  provider: null,
  ethers: null,
  account: null,
  devMode: false,
  devPlayerId: localStorage.getItem("math-clash:dev-player") || "player1",
  profile: null,
  xp: null,
  tasks: [],
  leaderboardSort: "top",
  selectedToken: "ETH",
  mode: localStorage.getItem("math-clash:mode") || "math",
  quizCategoryOptions: DEFAULT_QUIZ_CATEGORIES,
  selectedQuizCategories: loadStoredQuizCategories(),
  difficulty: "medium",
  match: null,
  playerId: null,
  localScore: 0,
  timerId: null,
  pollId: null,
  busy: false
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  connectWallet: $("#connectWallet"),
  saveMiniApp: $("#saveMiniApp"),
  shareMiniApp: $("#shareMiniApp"),
  tokenControls: $("#tokenControls"),
  modeControls: $("#modeControls"),
  quizCategoryBlock: $("#quizCategoryBlock"),
  quizCategories: $("#quizCategories"),
  difficultyControls: $("#difficultyControls"),
  payAndPlay: $("#payAndPlay"),
  demoPlay: $("#demoPlay"),
  cancelMatch: $("#cancelMatch"),
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
  readyButton: $("#readyButton"),
  playerName: $("#playerName"),
  playerMeta: $("#playerMeta"),
  rivalName: $("#rivalName"),
  rivalMeta: $("#rivalMeta"),
  statMatches: $("#statMatches"),
  statWins: $("#statWins"),
  statBest: $("#statBest"),
  statAccuracy: $("#statAccuracy"),
  leaderboard: $("#leaderboard"),
  refreshLeaderboard: $("#refreshLeaderboard"),
  leaderboardSort: $("#leaderboardSort"),
  leaderboardSearch: $("#leaderboardSearch"),
  refreshChat: $("#refreshChat"),
  chatForm: $("#chatForm"),
  chatInput: $("#chatInput"),
  chatList: $("#chatList"),
  lastChat: $("#lastChat"),
  devPanel: $("#devPanel"),
  resetDevState: $("#resetDevState"),
  xpLevel: $("#xpLevel"),
  xpTotal: $("#xpTotal"),
  xpHistory: $("#xpHistory"),
  questsList: $("#questsList"),
  refreshQuests: $("#refreshQuests")
};

boot();

async function boot() {
  updateSelectedTokenLabels();
  renderModeControls();
  bindEvents();
  refreshPaymentControls();
  await loadGameOptions();
  await initMiniApp();
  await restoreSession();
  await loadLeaderboard();
  await loadChat();
}

function bindEvents() {
  elements.connectWallet.addEventListener("click", connectWallet);
  elements.saveMiniApp.addEventListener("click", saveMiniApp);
  elements.shareMiniApp.addEventListener("click", shareMiniApp);
  elements.payAndPlay.addEventListener("click", payAndPlay);
  elements.readyButton.addEventListener("click", markReady);
  elements.cancelMatch.addEventListener("click", cancelCurrentMatch);
  elements.demoPlay.addEventListener("click", () => joinArena({ demo: true, txHash: "" }));
  elements.refreshLeaderboard.addEventListener("click", loadLeaderboard);
  elements.leaderboardSort.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-sort]");
    if (!button) return;
    state.leaderboardSort = button.dataset.sort;
    updateSegments(elements.leaderboardSort, button);
    await loadLeaderboard();
  });
  elements.leaderboardSearch.addEventListener("input", debounce(loadLeaderboard, 250));
  elements.refreshChat.addEventListener("click", loadChat);
  elements.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendChatMessage();
  });
  elements.refreshQuests.addEventListener("click", loadProfile);
  elements.resetDevState.addEventListener("click", resetDevState);
  elements.questsList.addEventListener("click", async (event) => {
    const card = event.target.closest("[data-task-id]");
    if (!card) return;
    const taskId = card.dataset.taskId;
    const input = card.querySelector("[data-proof-input]");
    const status = card.querySelector("[data-claim-status]");

    if (event.target.closest("[data-share-result]")) {
      await shareResultCast();
      return;
    }

    if (event.target.closest("[data-claim-task]")) {
      try {
        await claimQuest(taskId, input?.value || "");
        if (status) status.textContent = "Claim submitted for review.";
      } catch (error) {
        if (status) status.textContent = error.message;
      }
    }
  });

  document.querySelectorAll("[data-dev-player]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.devPlayerId = button.dataset.devPlayer;
      localStorage.setItem("math-clash:dev-player", state.devPlayerId);
      updateDevButtons();
      await restoreSession();
    });
  });

  elements.tokenControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-token]");
    if (!button || !canChangeGameOptions()) return;
    state.selectedToken = button.dataset.token;
    updateSegments(elements.tokenControls, button);
    updateSelectedTokenLabels();
    refreshPaymentControls();
  });

  elements.modeControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button || !canChangeGameOptions()) return;
    state.mode = button.dataset.mode === "quiz" ? "quiz" : "math";
    localStorage.setItem("math-clash:mode", state.mode);
    renderModeControls();
  });

  elements.quizCategories.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quiz-category]");
    if (!button || !canChangeGameOptions()) return;
    toggleQuizCategory(button.dataset.quizCategory);
  });

  elements.difficultyControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-difficulty]");
    if (!button || !canChangeGameOptions()) return;
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
    await loadFarcasterContext();
    await state.sdk.actions.ready();
    refreshMiniAppActions();
  } catch (error) {
    console.info("Farcaster SDK not available in this environment:", error.message);
  }
}

async function loadFarcasterContext() {
  try {
    const context = await Promise.resolve(state.sdk?.context);
    const user = context?.user || {};
    state.fid = user.fid || null;
    state.username = user.username || user.displayName || "";
  } catch (error) {
    console.info("Farcaster context unavailable:", error.message);
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
    setStatus("Mini App saved in Farcaster.");
  } catch (error) {
    setStatus(getMiniAppActionErrorMessage(error, "Could not save Mini App."));
  }
}

async function shareMiniApp() {
  const appUrl = CONFIG.appUrl || window.location.origin;

  try {
    if (typeof state.sdk?.actions?.composeCast !== "function") {
      setStatus("Open in Farcaster to share this Mini App.");
      return;
    }

    await state.sdk.actions.composeCast({
      text: `I am playing ${CONFIG.appName}. Beat me in a 1v1 brain battle.`,
      embeds: [appUrl]
    });
  } catch (error) {
    setStatus(getMiniAppActionErrorMessage(error, "Could not open Farcaster composer."));
  }
}

async function shareResultCast() {
  const appUrl = CONFIG.appUrl || window.location.origin;
  const me = getMe();
  const score = me ? `${me.score} pts` : `a ${CONFIG.appName} run`;
  const text = `I scored ${score} in ${CONFIG.appName}. Try to beat me in a 1v1 battle.`;

  try {
    if (typeof state.sdk?.actions?.composeCast !== "function") {
      setStatus("Open in Farcaster to share your result.");
      return;
    }

    await state.sdk.actions.composeCast({
      text,
      embeds: [appUrl]
    });
    setStatus("After publishing, paste the cast URL in the quest proof field.");
  } catch (error) {
    setStatus(getMiniAppActionErrorMessage(error, "Could not open Farcaster composer."));
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
    await restoreSession();
  } catch (error) {
    setStatus(getWalletErrorMessage(error, "Wallet connection failed."));
  }
}

async function restoreSession() {
  try {
    const response = await api(`/api/me?${new URLSearchParams(getIdentityPayload())}`);
    applyProfile(response);

    if (response.match) {
      applyMatch(response.match);
      if (response.match.status !== "finished" && response.match.status !== "refunded") {
        startPolling();
      }
    } else if (!state.match) {
      setStatus("Pick a token, difficulty, and enter the arena.");
      setQuestion("Ready?");
    }
  } catch (error) {
    console.info("Session restore skipped:", error.message);
  }
}

async function loadProfile() {
  const response = await api(`/api/tasks?${new URLSearchParams(getIdentityPayload())}`);
  applyProfile(response);
}

async function loadGameOptions() {
  try {
    const health = await api("/api/health");
    if (Array.isArray(health.quizCategories) && health.quizCategories.length) {
      state.quizCategoryOptions = health.quizCategories;
    }
  } catch (error) {
    console.info("Game options loaded from defaults:", error.message);
  }
  ensureQuizCategoriesSelected();
  renderModeControls();
}

function applyProfile(response) {
  if (typeof response.devMode !== "undefined") {
    state.devMode = Boolean(response.devMode);
  }
  state.profile = response.player || state.profile;
  state.xp = response.xp || state.xp;
  state.tasks = response.tasks || state.tasks || [];
  renderDevMode();
  renderXp(response.xpEvents || []);
  renderQuests();
}

function getIdentityPayload() {
  const wallet = state.account || localStorage.getItem("math-clash:last-wallet") || "";
  return {
    fid: state.fid || "",
    username: state.username || "",
    wallet,
    devPlayerId: state.devPlayerId || ""
  };
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

async function cancelCurrentMatch() {
  const match = state.match;
  if (!match?.payment?.escrowId) return;

  const availableAt = Number(match.payment.cancelAvailableAt || 0);
  if (availableAt && Date.now() < availableAt) {
    const minutes = Math.ceil((availableAt - Date.now()) / 60000);
    setStatus(`Refund unlocks in about ${minutes} min if no opponent joins.`);
    return;
  }

  try {
    state.busy = true;
    refreshPaymentControls();
    refreshMatchActions();

    if (!state.account) {
      await connectWallet();
    }
    if (!state.provider || !state.account) {
      setStatus("Connect the funding wallet to cancel.");
      return;
    }

    await ensureBaseChain(state.provider);
    setStatus("Submitting unmatched refund...");
    const txHash = await sendContractCall({
      provider: state.provider,
      from: state.account,
      to: CONFIG.escrowAddress,
      abi: ESCROW_ABI,
      functionName: "cancelUnmatched",
      args: [match.payment.escrowId]
    });
    await waitForTransactionSuccess(state.provider, txHash);
    const response = await api(`/api/matches/${match.matchId}/refund`, {
      method: "POST",
      body: {
        ...getIdentityPayload(),
        playerId: state.playerId,
        txHash
      }
    });
    applyMatch(response);
    setStatus(`Refund submitted: ${shortTx(txHash)}.`);
  } catch (error) {
    setStatus(getWalletErrorMessage(error, "Refund failed."));
  } finally {
    state.busy = false;
    refreshPaymentControls();
    refreshMatchActions();
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

function getMiniAppActionErrorMessage(error, fallback) {
  const message = String(error?.message || error || "");
  if (message.includes("RejectedByUser") || message.toLowerCase().includes("rejected")) {
    return "Farcaster request rejected.";
  }
  if (message.includes("InvalidDomainManifestJson")) {
    return "Farcaster manifest needs account association for this domain.";
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
      ...getIdentityPayload(),
      wallet,
      mode: state.mode,
      quizCategories: getSelectedQuizCategories(),
      difficulty: state.difficulty,
      token: state.selectedToken
    }
  });
}

async function joinArena({ demo, txHash, reservation = null }) {
  clearMatchLoops();
  state.localScore = 0;
  elements.score.textContent = "0";
  setQuestion("Ready?");
  setStatus(demo ? "Finding a demo rival..." : "Finding a rival...");

  const wallet = state.account || getGuestWallet();
  const response = await api("/api/matches/join", {
    method: "POST",
    body: {
      ...getIdentityPayload(),
      wallet,
      matchId: reservation?.matchId,
      playerId: reservation?.playerId,
      escrowId: reservation?.payment?.escrowId,
      mode: state.mode,
      quizCategories: getSelectedQuizCategories(),
      difficulty: state.difficulty,
      token: state.selectedToken,
      txHash,
      demo
    }
  });

  applyMatch(response);
  startPolling();
}

async function markReady() {
  const match = state.match;
  if (!match || state.busy) return;

  try {
    state.busy = true;
    refreshReadyAction();
    const response = await api(`/api/matches/${match.matchId}/ready`, {
      method: "POST",
      body: {
        ...getIdentityPayload(),
        playerId: state.playerId
      }
    });
    applyMatch(response);
    startPolling();
  } catch (error) {
    setStatus(error.message || "Could not start your run.");
  } finally {
    state.busy = false;
    refreshReadyAction();
  }
}

async function submitCurrentAnswer() {
  const match = state.match;
  if (!match || match.status !== "active") return;

  const answer = elements.answerInput.value.trim();
  if (!answer) return;

  elements.answerInput.value = "";
  elements.submitAnswer.disabled = true;

  const response = await api(`/api/matches/${match.matchId}/answer`, {
    method: "POST",
    body: {
      ...getIdentityPayload(),
      playerId: state.playerId,
      answer
    }
  });

  applyMatch(response.match);
}

function applyMatch(match) {
  const previousStatus = state.match?.status;
  const previousQuestionIndex = state.match?.currentQuestion?.index;

  state.match = match;
  state.playerId = match.playerId || state.playerId;
  syncGameControlsFromMatch(match);
  refreshMatchActions();
  refreshReadyAction();

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
    setStatus("Searching opponent...");
    setQuestion("Matchmaking");
    toggleAnswer(false);
  }

  if (match.status === "funding") {
    const paid = me?.paid ? "Rival is funding escrow..." : "Funding escrow...";
    setStatus(paid);
    setQuestion("Escrow");
    toggleAnswer(false);
  }

  if (match.status === "matched") {
    setStatus("Opponent found. Press Ready when you want to start.");
    setQuestion("Ready?");
    toggleAnswer(false);
    if (!state.pollId) startPolling();
  }

  if (match.status === "active") {
    if (!me?.ready || !me.runStartedAt) {
      setStatus("Opponent found. Press Ready when you want to start.");
      setQuestion("Ready?");
      toggleAnswer(false);
      if (!state.pollId) startPolling();
      return;
    }

    if (me?.finishedAt && !match.currentQuestion) {
      setQuestion("Done");
      setStatus("Waiting for rival result...");
      toggleAnswer(false);
      if (!state.timerId) startTimer();
      return;
    }

    const nextIndex = match.currentQuestion?.index ?? me?.answered ?? 0;
    const shouldRenderQuestion =
      previousStatus !== "active" ||
      nextIndex !== previousQuestionIndex ||
      elements.question.textContent === "Matchmaking" ||
      elements.question.textContent === "Ready?";
    if (shouldRenderQuestion) {
      renderQuestion();
    }
    toggleAnswer(Boolean(match.currentQuestion));
    if (match.currentQuestion) {
      setStatus("Clash live.");
    }
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
    loadProfile();
  }

  if (match.status === "refunded") {
    setStatus(`Refund marked${match.refundTxHash ? `: ${shortTx(match.refundTxHash)}` : "."}`);
    setQuestion("Refunded");
    toggleAnswer(false);
    clearMatchLoops();
  }
}

function renderQuestion() {
  const match = state.match;
  if (!match || match.status !== "active") return;
  const me = getMe();

  if (!me?.ready || !me.runStartedAt) {
    setQuestion("Ready?");
    setStatus("Opponent found. Press Ready when you want to start.");
    toggleAnswer(false);
    return;
  }

  if (!match.currentQuestion) {
    setQuestion("Done");
    setStatus("Waiting for rival result...");
    toggleAnswer(false);
    return;
  }

  const question = match.currentQuestion;
  setQuestion(question.expression.replace("*", "x"));
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
    body: { ...getIdentityPayload(), playerId: state.playerId }
  });
  applyMatch(response);
}

function startPolling() {
  clearInterval(state.pollId);
  state.pollId = window.setInterval(async () => {
    if (!state.match || ["finished", "refunded"].includes(state.match.status)) return;
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
  const me = getMe();
  if (!match?.startedAt || !me?.runStartedAt) {
    elements.timer.textContent = "--";
    return;
  }
  const elapsed = Date.now() - me.runStartedAt;
  const left = Math.max(0, Math.ceil(match.durationSec - elapsed / 1000));
  elements.timer.textContent = `${left}s`;
  if (left <= 0) {
    toggleAnswer(false);
  }
}

async function loadLeaderboard() {
  const params = new URLSearchParams({
    sort: state.leaderboardSort,
    search: elements.leaderboardSearch.value.trim()
  });
  const response = await api(`/api/leaderboard?${params}`);
  elements.leaderboard.innerHTML = "";

  if (!response.leaderboard.length) {
    const empty = document.createElement("li");
    empty.innerHTML = `<span class="rank">-</span><span class="name">No players found</span><span class="points">0</span>`;
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

async function loadChat() {
  const response = await api("/api/chat");
  renderChat(response.messages || [], response.lastMessage || null);
}

async function sendChatMessage() {
  const message = elements.chatInput.value.trim();
  if (!message) return;
  const response = await api("/api/chat", {
    method: "POST",
    body: {
      ...getIdentityPayload(),
      message
    }
  });
  elements.chatInput.value = "";
  renderChat(response.messages || [], response.lastMessage || response.message || null);
}

function renderChat(messages, lastMessage) {
  elements.lastChat.textContent = lastMessage
    ? `${lastMessage.display}: ${lastMessage.text}`
    : "No messages yet.";
  elements.chatList.innerHTML = "";
  messages.slice(0, 10).forEach((message) => {
    const item = document.createElement("li");
    item.innerHTML = `<strong>${escapeHtml(message.display)}</strong><span>${escapeHtml(message.text)}</span>`;
    elements.chatList.append(item);
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

function updateActiveButton(container, dataName, value) {
  container.querySelectorAll(`[data-${dataName}]`).forEach((button) => {
    button.classList.toggle("active", button.dataset[dataName] === value);
  });
}

function refreshPaymentControls() {
  const hasEscrow = isUsableEscrow();
  const hasToken = isSelectedTokenConfigured();
  const lockedInMatch = !canChangeGameOptions();
  elements.payAndPlay.disabled = state.busy || lockedInMatch || !hasEscrow || !hasToken;
  elements.demoPlay.hidden = !CONFIG.demoMode;
  elements.demoPlay.disabled = state.busy || lockedInMatch;

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

function refreshMatchActions() {
  const match = state.match;
  const canCancel =
    match?.status === "waiting" &&
    match.payment?.mode === "escrow" &&
    Boolean(match.payment?.cancelAvailableAt);
  elements.cancelMatch.hidden = !canCancel;
  if (!canCancel) return;

  const availableAt = Number(match.payment.cancelAvailableAt);
  elements.cancelMatch.disabled = state.busy || Date.now() < availableAt;
  elements.cancelMatch.textContent =
    Date.now() >= availableAt ? "Cancel / Refund" : "Refund unlocks later";
}

function refreshReadyAction() {
  const match = state.match;
  const me = getMe();
  const canReady =
    Boolean(match) &&
    ["matched", "active"].includes(match.status) &&
    Boolean(me) &&
    !me.ready &&
    !me.finishedAt &&
    match.players.length >= 2;
  elements.readyButton.hidden = !canReady;
  elements.readyButton.disabled = state.busy || !canReady;
}

function syncGameControlsFromMatch(match) {
  if (!match || ["finished", "refunded"].includes(match.status)) return;

  state.mode = match.mode || state.mode;
  state.difficulty = match.difficulty || state.difficulty;
  state.selectedToken = match.payment?.token || state.selectedToken;
  if (Array.isArray(match.quizCategories) && match.quizCategories.length) {
    state.selectedQuizCategories = match.quizCategories;
  }

  updateActiveButton(elements.tokenControls, "token", state.selectedToken);
  updateActiveButton(elements.difficultyControls, "difficulty", state.difficulty);
  updateSelectedTokenLabels();
  renderModeControls();
  refreshPaymentControls();
}

function renderModeControls() {
  elements.modeControls.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
  elements.quizCategoryBlock.hidden = state.mode !== "quiz";
  renderQuizCategories();
}

function renderQuizCategories() {
  if (!elements.quizCategories) return;
  ensureQuizCategoriesSelected();
  elements.quizCategories.innerHTML = "";
  state.quizCategoryOptions.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-pill";
    button.dataset.quizCategory = category.id;
    button.classList.toggle("active", state.selectedQuizCategories.includes(category.id));
    button.textContent = category.label || category.id;
    elements.quizCategories.append(button);
  });
}

function toggleQuizCategory(categoryId) {
  const id = String(categoryId || "");
  if (!state.quizCategoryOptions.some((category) => category.id === id)) return;

  const selected = new Set(getSelectedQuizCategories());
  if (selected.has(id)) {
    if (selected.size <= 1) {
      setStatus("Leave at least one quiz category selected.");
      return;
    }
    selected.delete(id);
  } else {
    selected.add(id);
  }

  state.selectedQuizCategories = [...selected];
  localStorage.setItem("math-clash:quiz-categories", JSON.stringify(state.selectedQuizCategories));
  renderQuizCategories();
}

function ensureQuizCategoriesSelected() {
  const available = state.quizCategoryOptions.map((category) => category.id);
  state.selectedQuizCategories = state.selectedQuizCategories.filter((id) => available.includes(id));
  if (!state.selectedQuizCategories.length) {
    state.selectedQuizCategories = [...available];
  }
}

function getSelectedQuizCategories() {
  if (state.mode !== "quiz") return [];
  ensureQuizCategoriesSelected();
  return state.selectedQuizCategories;
}

function canChangeGameOptions() {
  return !state.match || ["finished", "refunded"].includes(state.match.status);
}

function renderDevMode() {
  elements.devPanel.hidden = !state.devMode;
  updateDevButtons();
}

function updateDevButtons() {
  document.querySelectorAll("[data-dev-player]").forEach((button) => {
    button.classList.toggle("active", button.dataset.devPlayer === state.devPlayerId);
  });
}

function renderXp(events = []) {
  const xp = state.xp || { total: 0, level: 1 };
  elements.xpTotal.textContent = `${xp.total || 0} XP`;
  elements.xpLevel.textContent = `Level ${xp.level || 1}`;
  elements.xpHistory.innerHTML = "";

  if (!events.length) {
    const item = document.createElement("li");
    item.innerHTML = `<span>No XP yet</span><strong>0</strong>`;
    elements.xpHistory.append(item);
    return;
  }

  events.slice(0, 6).forEach((event) => {
    const item = document.createElement("li");
    item.innerHTML = `<span>${escapeHtml(formatXpType(event.type))}</span><strong>+${event.amount}</strong>`;
    elements.xpHistory.append(item);
  });
}

function renderQuests() {
  elements.questsList.innerHTML = "";
  if (!state.tasks?.length) {
    elements.questsList.textContent = "No quests yet.";
    return;
  }

  state.tasks.forEach((task) => {
    const card = document.createElement("article");
    card.className = "quest-card";
    card.dataset.taskId = task.id;
    const latestStatus = task.latestClaim ? `Status: ${task.latestClaim.status}` : "Manual review";
    const isShare = task.type === "share_result";
    card.innerHTML = `
      <h3>${escapeHtml(task.title)}</h3>
      <p>${escapeHtml(task.description)}</p>
      <div class="quest-meta">+${task.xpReward} XP - ${task.repeatable ? "repeatable" : "one time"} - ${latestStatus}</div>
      <div class="quest-actions">
        <input type="url" placeholder="Cast URL / proof URL" data-proof-input>
        ${isShare ? '<button type="button" data-share-result>Share result</button>' : ""}
        <button type="button" data-claim-task>Claim</button>
      </div>
      <div class="claim-status" data-claim-status></div>
    `;
    elements.questsList.append(card);
  });
}

async function claimQuest(taskId, proofUrl) {
  const response = await api(`/api/tasks/${taskId}/claim`, {
    method: "POST",
    body: {
      ...getIdentityPayload(),
      proofUrl
    }
  });
  applyProfile(response);
}

async function resetDevState() {
  if (!state.devMode) return;
  await api("/api/dev/reset", { method: "POST", body: {} });
  localStorage.removeItem("math-clash:last-wallet");
  state.match = null;
  state.playerId = null;
  await restoreSession();
  setStatus("Dev state reset.");
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

function loadStoredQuizCategories() {
  try {
    const parsed = JSON.parse(localStorage.getItem("math-clash:quiz-categories") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

function formatXpType(type) {
  return String(type || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function debounce(fn, ms) {
  let id = null;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
