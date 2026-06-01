import { keccak256, solidityPacked, toUtf8Bytes } from "ethers";

const DEFAULT_APP_URL = "https://your-domain.example";

export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (context.request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const response = await context.next();
    const html = await response.text();
    return htmlResponse(injectHtmlTemplate(html, context));
  }

  if (context.request.method === "GET" && url.pathname === "/config.js") {
    return jsResponse(`window.MATH_CLASH_CONFIG = ${JSON.stringify(clientConfig(context), null, 2)};\n`);
  }

  if (context.request.method === "GET" && url.pathname === "/.well-known/farcaster.json") {
    return jsonResponse(buildFarcasterManifest(context));
  }

  if (context.request.method === "GET" && url.pathname === "/api/health") {
    return jsonResponse({
      ok: true,
      appName: appName(context),
      baseChainId: baseChainId(context),
      gameContractConfigured: Boolean(gameContractAddress(context)),
      chatKvConfigured: Boolean(chatKv(context)),
      adminConfigured: Boolean(context.env.ADMIN_TOKEN),
      provablyFair: "commit-reveal-v1",
      game: "on-chain-poker-table",
      runtime: "cloudflare-pages"
    });
  }

  if (url.pathname === "/api/admin/state" && context.request.method === "GET") {
    return getAdminState(context);
  }

  if (url.pathname.startsWith("/api/admin/") && context.request.method === "POST") {
    return handleAdminAction(context, url);
  }

  if (url.pathname === "/api/lobby/join" && context.request.method === "POST") {
    return joinLobby(context);
  }

  if (url.pathname === "/api/lobby/tables" && context.request.method === "GET") {
    return getLobbyTables(context, url);
  }

  if (url.pathname === "/api/lobby/status" && context.request.method === "GET") {
    return getLobbyStatus(context, url);
  }

  if (url.pathname.startsWith("/api/tables/")) {
    const parts = url.pathname.split("/");
    const tableId = parts[3];
    const action = parts[4];
    if (context.request.method === "GET" && tableId) {
      return getTableState(context, tableId, url);
    }
    if (context.request.method === "POST" && tableId && action === "sync") {
      return syncTableState(context, tableId);
    }
    if (context.request.method === "POST" && tableId && action === "fair") {
      return handleFairAction(context, tableId, parts[5]);
    }
    if (context.request.method === "POST" && tableId && action === "simulate") {
      return simulateTableAction(context, tableId);
    }
  }

  if (url.pathname === "/api/chat") {
    if (context.request.method === "GET") {
      return getChatMessages(context, url);
    }
    if (context.request.method === "POST") {
      return saveChatMessage(context);
    }
  }

  return context.next();
}

async function getAdminState(context) {
  const auth = requireAdmin(context);
  if (!auth.ok) return auth.response;

  const lobby = await readLobby(context);
  const tableIds = lobby.tableIds || [];
  const tables = [];
  for (const tableId of tableIds.slice(-25)) {
    const table = await readPokerTable(context, tableId);
    if (table) tables.push(adminTableSummary(table));
  }

  return jsonResponse({
    ok: true,
    waitingTableId: lobby.waitingTableId || "",
    tables: tables.reverse()
  });
}

async function handleAdminAction(context, url) {
  const auth = requireAdmin(context);
  if (!auth.ok) return auth.response;

  const action = url.pathname.replace(/^\/api\/admin\//, "");
  if (action === "bots/create-waiting") return adminCreateBotWaiting(context);
  if (action === "bots/fill-waiting") return adminFillWaitingWithBot(context);
  if (action === "reset-lobby") return adminResetLobby(context);
  return jsonResponse({ error: "Unknown admin action" }, 404);
}

async function adminCreateBotWaiting(context) {
  const lobby = await readLobby(context);
  const bot = createBot();
  const table = createPokerTable(bot.address);
  markBotTable(table, bot);
  lobby.waitingTableId = table.id;
  trackTable(lobby, table.id);
  trackPlayerTable(lobby, table.player1, table.id);
  await writePokerTable(context, table);
  await writeLobby(context, lobby);
  return jsonResponse({ ok: true, bot, table: publicTable(table, "") });
}

async function adminFillWaitingWithBot(context) {
  const lobby = await readLobby(context);
  const waitingId = normalizeTableId(lobby.waitingTableId);
  if (!waitingId) {
    return adminCreateBotWaiting(context);
  }

  const table = await readPokerTable(context, waitingId);
  if (!table || !tableHasOpenSeat(table)) {
    return adminCreateBotWaiting(context);
  }

  const bot = createBot();
  addPlayerToTable(table, bot.address);
  table.status = tablePlayers(table).length >= 2 ? "confirming" : "waiting";
  table.stage = table.status;
  table.updatedAt = new Date().toISOString();
  markBotTable(table, bot);
  dealTableCards(table);
  lobby.waitingTableId = tableHasOpenSeat(table) ? table.id : "";
  trackTable(lobby, table.id);
  for (const player of tablePlayers(table)) trackPlayerTable(lobby, player, table.id);
  await writePokerTable(context, table);
  await writeLobby(context, lobby);
  return jsonResponse({ ok: true, bot, table: publicTable(table, "") });
}

async function adminResetLobby(context) {
  const lobby = await readLobby(context);
  lobby.waitingTableId = "";
  await writeLobby(context, lobby);
  return jsonResponse({ ok: true, waitingTableId: "" });
}

async function joinLobby(context) {
  const kv = chatKv(context);
  if (!kv) {
    return jsonResponse({ error: "CHAT_KV is required for lobby matchmaking." }, 503);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Bad JSON" }, 400);
  }

  const walletAddress = normalizeAddress(body.walletAddress);
  if (!walletAddress) {
    return jsonResponse({ error: "walletAddress required" }, 400);
  }

  const lobby = await readLobby(context);
  let table = null;
  const requestedTableId = normalizeTableId(body.tableId);
  const existingTable = await findPlayerTable(context, lobby, walletAddress, requestedTableId);
  if (existingTable) {
    return jsonResponse({ table: publicTable(existingTable, walletAddress), restored: true });
  }

  if (requestedTableId && !body.create) {
    const requestedTable = await readPokerTable(context, requestedTableId);
    if (!requestedTable) return jsonResponse({ error: "Table not found" }, 404);
    if (!tableHasOpenSeat(requestedTable)) return jsonResponse({ error: "Table is not open for new seats." }, 409);
    addPlayerToTable(requestedTable, walletAddress);
    table = requestedTable;
  }

  if (!table && !body.create) {
    table = await firstOpenLobbyTable(context, lobby, walletAddress);
    if (table) addPlayerToTable(table, walletAddress);
  }

  if (!table) {
    table = createPokerTable(walletAddress);
    trackTable(lobby, table.id);
  }

  if (table.bots && Object.keys(table.bots).length) {
    table.simulation = true;
    if (tablePlayers(table).length >= 2 && table.stage === "waiting") {
      table.status = "confirming";
      table.stage = "confirming";
      dealTableCards(table);
    }
  }
  trackTable(lobby, table.id);
  for (const player of tablePlayers(table)) trackPlayerTable(lobby, player, table.id);
  lobby.waitingTableId = tableHasOpenSeat(table) ? table.id : await firstOpenLobbyTableId(context, lobby);
  await writePokerTable(context, table);
  await writeLobby(context, lobby);
  return jsonResponse({ table: publicTable(table, walletAddress) });
}

async function getLobbyTables(context, url) {
  const lobby = await readLobby(context);
  const viewer = normalizeAddress(url.searchParams.get("walletAddress"));
  const tables = [];
  for (const tableId of [...(lobby.tableIds || [])].reverse()) {
    const table = await readPokerTable(context, tableId);
    if (!table) continue;
    normalizePokerTable(table);
    if (table.status === "finished" || normalizeStage(table.stage) === "finished") continue;
    tables.push(publicTable(table, viewer));
  }
  return jsonResponse({ ok: true, tables: tables.slice(0, 50), waitingTableId: lobby.waitingTableId || "" });
}

async function getLobbyStatus(context, url) {
  const walletAddress = normalizeAddress(url.searchParams.get("walletAddress"));
  if (!walletAddress) return jsonResponse({ error: "walletAddress required" }, 400);

  const lobby = await readLobby(context);
  const table = await findPlayerTable(context, lobby, walletAddress, normalizeTableId(url.searchParams.get("tableId")));
  return jsonResponse({
    ok: true,
    table: table ? publicTable(table, walletAddress) : null,
    waitingTableId: lobby.waitingTableId || ""
  });
}

async function getTableState(context, rawTableId, url) {
  const tableId = normalizeTableId(rawTableId);
  if (!tableId) return jsonResponse({ error: "Bad table id" }, 400);
  const table = await readPokerTable(context, tableId);
  if (!table) return jsonResponse({ error: "Table not found" }, 404);
  return jsonResponse({ table: publicTable(table, normalizeAddress(url.searchParams.get("player"))) });
}

async function syncTableState(context, rawTableId) {
  const tableId = normalizeTableId(rawTableId);
  if (!tableId) return jsonResponse({ error: "Bad table id" }, 400);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Bad JSON" }, 400);
  }

  const table = await readPokerTable(context, tableId);
  if (!table) return jsonResponse({ error: "Table not found" }, 404);

  const stage = normalizeStage(body.stage);
  if (stage) {
    table.stage = stage;
    table.status =
      stage === "finished" ? "finished" : stage === "waiting" ? "waiting" : stage === "confirming" ? "confirming" : "playing";
  }

  const handId = Number(body.handId || 0);
  if (Number.isSafeInteger(handId) && handId > 0) {
    table.handId = handId;
    if (stage === "waiting_for_commit" && !table.fair?.handId) {
      prepareFairHand(table, handId);
    }
  }
  const player1 = normalizeAddress(body.player1);
  const player2 = normalizeAddress(body.player2);
  if (player1) table.player1 = player1;
  if (player2) table.player2 = player2;
  if (Array.isArray(body.players)) {
    const players = body.players.map(normalizeAddress).filter(Boolean);
    if (players.length) {
      table.players = [...new Set(players)].slice(0, 6);
      normalizePokerTable(table);
    }
  } else {
    normalizePokerTable(table);
  }
  applyChainHandSeed(table, body.handSeed);

  const winner = normalizeAddress(body.winner);
  if (winner) table.winner = winner;
  if (table.stage === "showdown" && !table.winner) {
    table.winner = pickWinner(table);
  }

  table.updatedAt = new Date().toISOString();
  await writePokerTable(context, table);
  return jsonResponse({ table: publicTable(table, normalizeAddress(body.viewer || body.walletAddress)) });
}

async function handleFairAction(context, rawTableId, action) {
  const tableId = normalizeTableId(rawTableId);
  if (!tableId) return jsonResponse({ error: "Bad table id" }, 400);
  if (action !== "commit" && action !== "reveal") {
    return jsonResponse({ error: "Unknown provably fair action" }, 404);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Bad JSON" }, 400);
  }

  const walletAddress = normalizeAddress(body.walletAddress);
  const table = await readPokerTable(context, tableId);
  if (!table) return jsonResponse({ error: "Table not found" }, 404);
  if (table.simulation) return jsonResponse({ error: "Bot tables skip commit-reveal fairness." }, 400);
  if (!walletAddress || !isTablePlayer(table, walletAddress)) {
    return jsonResponse({ error: "Only table players can update fair state." }, 403);
  }

  const handId = Number(body.handId || table.handId || 1);
  if (!Number.isSafeInteger(handId) || handId <= 0) {
    return jsonResponse({ error: "Bad hand id" }, 400);
  }
  ensureFairHand(table, handId);

  if (action === "commit") {
    const commit = normalizeBytes32(body.commit);
    if (!commit) return jsonResponse({ error: "commit bytes32 required" }, 400);
    table.fair.commits[walletAddress] = commit;
    table.updatedAt = new Date().toISOString();
    await writePokerTable(context, table);
    return jsonResponse({ ok: true, table: publicTable(table, walletAddress) });
  }

  const secret = String(body.secret || "").trim();
  if (!secret) return jsonResponse({ error: "secret required" }, 400);
  const commit = table.fair.commits?.[walletAddress];
  if (!commit) return jsonResponse({ error: "Commit first" }, 400);
  const expected = seedCommit(secret, walletAddress, table.id, handId);
  if (expected.toLowerCase() !== commit.toLowerCase()) {
    return jsonResponse({ error: "Secret does not match commit" }, 400);
  }

  table.fair.reveals[walletAddress] = secret;

  if (tablePlayers(table).every((player) => table.fair.reveals[player])) {
    finalizeFairDeck(table, context);
  }

  table.updatedAt = new Date().toISOString();
  await writePokerTable(context, table);
  return jsonResponse({ ok: true, table: publicTable(table, walletAddress) });
}

async function simulateTableAction(context, rawTableId) {
  const tableId = normalizeTableId(rawTableId);
  if (!tableId) return jsonResponse({ error: "Bad table id" }, 400);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Bad JSON" }, 400);
  }

  const walletAddress = normalizeAddress(body.walletAddress);
  const table = await readPokerTable(context, tableId);
  if (!table) return jsonResponse({ error: "Table not found" }, 404);
  if (!table.simulation) return jsonResponse({ error: "This table is not in bot simulation mode" }, 400);
  if (!walletAddress || !isTablePlayer(table, walletAddress) || isBot(table, walletAddress)) {
    return jsonResponse({ error: "Only the human player can control this bot test table" }, 403);
  }

  const action = String(body.action || "").toLowerCase();
  if (table.stage === "confirming" && action === "confirm") {
    table.stage = "preflop";
    table.status = "playing";
    table.turn = walletAddress;
    table.pot = table.pot || "0";
  } else if (ACTIVE_SIM_STAGES.includes(table.stage) && sameAddress(table.turn, walletAddress)) {
    try {
      applySimulationAction(table, walletAddress, action, body.amount);
    } catch (error) {
      return jsonResponse({ error: error.message || "Bad simulation action" }, 400);
    }
  } else {
    return jsonResponse({ error: "Not your turn" }, 400);
  }

  table.updatedAt = new Date().toISOString();
  await writePokerTable(context, table);
  return jsonResponse({ ok: true, table: publicTable(table, walletAddress) });
}

function clientConfig(context) {
  const chainId = baseChainId(context);
  return {
    appName: appName(context),
    appUrl: appUrl(context),
    gameContractAddress: gameContractAddress(context),
    escrowAddress: gameContractAddress(context),
    defaultStakeEth: context.env.DEFAULT_STAKE_ETH || context.env.LOW_LIMIT_BUY_IN_ETH || "0.0001",
    defaultBetEth: context.env.DEFAULT_BET_ETH || context.env.LOW_LIMIT_ANTE_ETH || "0.00001",
    developerFeeBps: 200,
    maxSeats: 6,
    chain: {
      id: chainId,
      hex: `0x${chainId.toString(16)}`,
      name: chainId === 8453 ? "Base" : "Base Sepolia",
      rpcUrl: context.env.BASE_RPC_URL || context.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      explorerUrl: chainId === 8453 ? "https://basescan.org" : "https://sepolia-explorer.base.org"
    }
  };
}

function injectHtmlTemplate(html, context) {
  const miniAppEmbed = createMiniAppEmbed(context);
  return html
    .replaceAll("__APP_NAME__", escapeHtmlText(appName(context)))
    .replaceAll("__APP_URL__", escapeHtmlAttr(appUrl(context)))
    .replaceAll("__MINIAPP_EMBED_JSON__", escapeHtmlAttr(JSON.stringify(miniAppEmbed)))
    .replaceAll("__FRAME_EMBED_JSON__", escapeHtmlAttr(JSON.stringify(miniAppEmbed)));
}

function buildFarcasterManifest(context) {
  const accountAssociation = buildAccountAssociation(context);
  const miniapp = buildMiniAppManifest(context);
  const manifest = {
    accountAssociation,
    miniapp,
    frame: miniapp
  };

  if (!accountAssociation) {
    delete manifest.accountAssociation;
  }

  if (context.env.FARCASTER_HOSTED_MANIFEST_ID) {
    manifest.miniapp.hostedManifestId = context.env.FARCASTER_HOSTED_MANIFEST_ID;
    manifest.frame.hostedManifestId = context.env.FARCASTER_HOSTED_MANIFEST_ID;
  }

  if (appUrl(context) === DEFAULT_APP_URL) {
    manifest._debug = "Set APP_URL before production deploy.";
  }

  return stripUndefined(manifest);
}

function buildMiniAppManifest(context) {
  const chainId = baseChainId(context);
  const noindex =
    context.env.FARCASTER_NOINDEX === "true" ||
    (context.env.FARCASTER_NOINDEX !== "false" && chainId !== 8453);

  return stripUndefined({
    version: "1",
    name: appName(context).slice(0, 32),
    homeUrl: appUrl(context),
    canonicalDomain: canonicalDomain(context),
    iconUrl: `${appUrl(context)}/assets/icon.png`,
    splashImageUrl: `${appUrl(context)}/assets/splash.png`,
    splashBackgroundColor: "#111318",
    heroImageUrl: `${appUrl(context)}/assets/og.png`,
    subtitle: "6-seat on-chain poker table",
    description: "Choose a low-limit table, send real ETH into the pot, call or fold, and settle each hand on-chain.",
    tagline: "Find. Bet. Settle.",
    primaryCategory: "games",
    tags: ["poker", "bluff", "base", "pvp"],
    ogTitle: appName(context),
    ogDescription: "A six-seat poker table where every bet and call sends ETH into the hand pot.",
    ogImageUrl: `${appUrl(context)}/assets/og.png`,
    requiredChains: [`eip155:${chainId}`],
    requiredCapabilities: [
      "actions.ready",
      "actions.addMiniApp",
      "actions.composeCast",
      "wallet.getEthereumProvider"
    ],
    noindex
  });
}

function createMiniAppEmbed(context) {
  return {
    version: "1",
    imageUrl: `${appUrl(context)}/assets/og.png`,
    button: {
      title: `Play ${appName(context)}`,
      action: {
        type: "launch_miniapp",
        name: appName(context),
        url: appUrl(context),
        splashImageUrl: `${appUrl(context)}/assets/splash.png`,
        splashBackgroundColor: "#111318"
      }
    }
  };
}

async function getChatMessages(context, url) {
  const room = normalizeRoom(url.searchParams.get("room"));
  const messages = await readChatRoom(context, room);
  return jsonResponse({ room, messages: messages.slice(-25) });
}

async function saveChatMessage(context) {
  const kv = chatKv(context);
  if (!kv) {
    return jsonResponse({ error: "Configure CHAT_KV binding for persistent chat on Cloudflare Pages." }, 503);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Bad JSON" }, 400);
  }

  const room = normalizeRoom(body.room);
  const message = String(body.message || "").trim().slice(0, 180);
  const player = String(body.player || "guest").trim().slice(0, 32) || "guest";
  if (!message) {
    return jsonResponse({ error: "Message required" }, 400);
  }

  const messages = await readChatRoom(context, room);
  messages.push({
    id: `${Date.now()}-${crypto.randomUUID()}`,
    room,
    player,
    message,
    createdAt: new Date().toISOString()
  });
  const saved = messages.slice(-100);
  await kv.put(chatKey(room), JSON.stringify(saved));
  return jsonResponse({ ok: true, room, messages: saved.slice(-25) });
}

async function readChatRoom(context, room) {
  const kv = chatKv(context);
  if (!kv) return [];
  const messages = await kv.get(chatKey(room), "json");
  return Array.isArray(messages) ? messages : [];
}

function chatKv(context) {
  return context.env.CHAT_KV || context.env.KV || null;
}

async function readLobby(context) {
  const kv = chatKv(context);
  const lobby = kv ? await kv.get("poker:lobby", "json") : null;
  return normalizeLobby(lobby);
}

async function writeLobby(context, lobby) {
  const kv = chatKv(context);
  if (kv) await kv.put("poker:lobby", JSON.stringify(lobby));
}

async function readPokerTable(context, tableId) {
  const kv = chatKv(context);
  if (!kv) return null;
  const table = await kv.get(tableKey(tableId), "json");
  return table && typeof table === "object" ? table : null;
}

async function writePokerTable(context, table) {
  const kv = chatKv(context);
  if (kv) await kv.put(tableKey(table.id), JSON.stringify(table));
}

function createPokerTable(walletAddress) {
  const now = new Date().toISOString();
  const id = randomTableId();
  const player = normalizeAddress(walletAddress);
  return {
    id,
    status: "waiting",
    stage: "waiting",
    maxSeats: 6,
    players: player ? [player] : [],
    player1: player,
    player2: "",
    stake: "0.0001",
    pot: "0",
    turn: "",
    simulation: false,
    bots: {},
    playerLabels: {},
    winner: "",
    handId: 0,
    fair: null,
    deck: [],
    playerCards: {},
    communityCards: [],
    createdAt: now,
    updatedAt: now
  };
}

function markBotTable(table, bot) {
  normalizePokerTable(table);
  table.simulation = true;
  table.bots = { ...(table.bots || {}), [normalizeAddress(bot.address)]: true };
  table.playerLabels = { ...(table.playerLabels || {}), [normalizeAddress(bot.address)]: bot.name };
}

function dealTableCards(table) {
  const players = tablePlayers(table);
  if (players.length < 2 || table.communityCards?.length) return;
  const neededCards = players.length * 2 + 5;
  const deck = Array.isArray(table.deck) && table.deck.length >= neededCards ? table.deck : shuffleDeck(table.id);
  table.playerCards = {};
  for (let i = 0; i < players.length; i += 1) {
    table.playerCards[players[i]] = [deck[i], deck[i + players.length]];
  }
  table.communityCards = deck.slice(players.length * 2, players.length * 2 + 5);
}

function prepareFairHand(table, handId) {
  table.handId = handId || Number(table.handId || 0) + 1;
  table.fair = {
    version: "commit-reveal-v1",
    handId: table.handId,
    commits: {},
    reveals: {},
    chainData: "",
    seed: "",
    deckHash: "",
    finalDeck: [],
    createdAt: new Date().toISOString()
  };
  table.deck = [];
  table.playerCards = {};
  table.communityCards = [];
}

function ensureFairHand(table, handId) {
  if (!table.fair || Number(table.fair.handId || 0) !== handId) {
    prepareFairHand(table, handId);
  }
  table.fair.commits = table.fair.commits || {};
  table.fair.reveals = table.fair.reveals || {};
}

function finalizeFairDeck(table, context) {
  const players = tablePlayers(table);
  const secrets = players.map((player) => table.fair.reveals[player]);
  if (players.length < 2 || secrets.some((secret) => !secret)) return;
  const contract = normalizeAddress(gameContractAddress(context)) || "0x0000000000000000000000000000000000000000";
  const seed = keccak256(
    solidityPacked(
      ["bytes32", "uint256", "uint256", "address", ...secrets.map(() => "string")],
      [table.id, BigInt(table.fair.handId), BigInt(baseChainId(context)), contract, ...secrets]
    )
  );
  const deck = shuffleDeck(seed);
  table.fair.seed = seed;
  table.fair.deckHash = deckHash(deck);
  table.fair.finalDeck = deck;
  table.deck = deck;
  dealDeckToPlayers(table, deck, players);
}

function finalizeFairDeckFromSeed(table, seed) {
  const players = tablePlayers(table);
  const deck = shuffleDeck(seed);
  table.fair.seed = seed;
  table.fair.deckHash = deckHash(deck);
  table.fair.finalDeck = deck;
  table.deck = deck;
  dealDeckToPlayers(table, deck, players);
}

function applyChainHandSeed(table, handSeed) {
  if (!handSeed || typeof handSeed !== "object" || !table.handId) return;
  ensureFairHand(table, Number(table.handId));
  const players = tablePlayers(table);
  const commits = Array.isArray(handSeed.commits) ? handSeed.commits : [handSeed.commit1, handSeed.commit2];
  const secrets = Array.isArray(handSeed.secrets) ? handSeed.secrets : [handSeed.secret1, handSeed.secret2];
  const revealed = Array.isArray(handSeed.revealed) ? handSeed.revealed : [handSeed.revealed1, handSeed.revealed2];
  for (let i = 0; i < players.length; i += 1) {
    const commit = normalizeBytes32(commits[i]);
    if (commit && commit !== zeroBytes32()) table.fair.commits[players[i]] = commit;
    if (revealed[i] && secrets[i]) table.fair.reveals[players[i]] = String(secrets[i]);
  }
  const seed = normalizeBytes32(handSeed.seed);
  if (handSeed.ready && seed && seed !== zeroBytes32()) {
    finalizeFairDeckFromSeed(table, seed);
  }
}

function publicTable(table, viewer) {
  normalizePokerTable(table);
  const stage = normalizeStage(table.stage) || "waiting";
  const visibleCommunity = communityForStage(table.communityCards || [], stage);
  const playerCards = viewer && table.playerCards ? table.playerCards[viewer] || [] : [];
  const players = tablePlayers(table);
  const maxSeats = Number(table.maxSeats || 6);
  return {
    id: table.id,
    status: table.status,
    stage,
    player1: table.player1 || "",
    player2: table.player2 || "",
    players,
    maxSeats,
    openSeats: Math.max(0, maxSeats - players.length),
    stake: table.stake || "0.0001",
    pot: table.pot || "0",
    turn: table.turn || "",
    simulation: Boolean(table.simulation),
    bots: table.bots || {},
    playerLabels: table.playerLabels || {},
    winner: table.winner || "",
    handId: Number(table.handId || table.fair?.handId || 0),
    fair: publicFairInfo(table, stage),
    playerCards,
    communityCards: visibleCommunity,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    prototypeNotice: "Commit-reveal creates the hand seed, but card dealing is still partially off-chain and not full mental poker/ZK."
  };
}

function publicFairInfo(table, stage) {
  const players = tablePlayers(table);
  const fair = table.fair;
  if (!fair) {
    return {
      version: "commit-reveal-v1",
      handId: Number(table.handId || 0),
      commits: {},
      revealedSecrets: {},
      seed: "",
      deckHash: "",
      deck: [],
      verifyAvailable: false
    };
  }

  const showDeck = ["showdown", "finished"].includes(stage);
  const commitsBySeat = players.map((player, index) => ({
    seat: index + 1,
    player,
    commit: fair.commits?.[player] || ""
  }));
  const revealsBySeat = players.map((player, index) => ({
    seat: index + 1,
    player,
    secret: fair.reveals?.[player] || ""
  }));
  return {
    version: fair.version || "commit-reveal-v1",
    handId: Number(fair.handId || table.handId || 0),
    commits: {
      player1: fair.commits?.[players[0]] || "",
      player2: fair.commits?.[players[1]] || ""
    },
    commitsBySeat,
    revealedSecrets: {
      player1: fair.reveals?.[players[0]] || "",
      player2: fair.reveals?.[players[1]] || ""
    },
    revealedSecretsBySeat: revealsBySeat,
    chainData: fair.chainData || "",
    seed: fair.seed || "",
    deckHash: fair.deckHash || "",
    deck: showDeck ? fair.finalDeck || [] : [],
    verifyAvailable: Boolean(fair.seed && fair.deckHash)
  };
}

const ACTIVE_SIM_STAGES = ["preflop", "flop", "turn", "river"];

function applySimulationAction(table, walletAddress, action, amount) {
  if (action === "fold") {
    table.winner = botOpponent(table, walletAddress);
    table.stage = "finished";
    table.status = "finished";
    table.turn = "";
    return;
  }

  if (action === "bet") {
    table.pot = addEthStrings(table.pot, amount);
    table.pot = addEthStrings(table.pot, amount);
    advanceSimulationStage(table, walletAddress);
    return;
  }

  if (action === "check" || action === "call") {
    advanceSimulationStage(table, walletAddress);
    return;
  }

  throw new Error("Unknown simulation action");
}

function advanceSimulationStage(table, walletAddress) {
  const current = normalizeStage(table.stage);
  if (current === "preflop") table.stage = "flop";
  else if (current === "flop") table.stage = "turn";
  else if (current === "turn") table.stage = "river";
  else {
    table.stage = "finished";
    table.status = "finished";
    table.winner = pickWinner(table);
    table.turn = "";
    return;
  }
  table.status = "playing";
  table.turn = walletAddress;
}

function addEthStrings(current, amount) {
  const sum = Number(current || 0) + Number(amount || 0);
  if (!Number.isFinite(sum) || sum < 0) return String(current || "0");
  return sum.toFixed(8).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

function botOpponent(table, walletAddress) {
  const players = tablePlayers(table);
  return players.find((player) => !sameAddress(player, walletAddress)) || "";
}

function isTablePlayer(table, walletAddress) {
  return tablePlayers(table).some((player) => sameAddress(player, walletAddress));
}

function isBot(table, walletAddress) {
  return Boolean(table.bots?.[normalizeAddress(walletAddress)]);
}

function sameAddress(a, b) {
  return Boolean(a && b && normalizeAddress(a) === normalizeAddress(b));
}

function createBot() {
  const names = ["Bot Alpha", "Bot Bravo", "Bot Charlie", "Bot Delta", "Bot Echo"];
  const address = randomBotAddress();
  return {
    id: `bot-${address.slice(2, 10)}`,
    name: names[hashSeed(address) % names.length],
    address
  };
}

function randomBotAddress() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  bytes[0] = 0xb0;
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function normalizePokerTable(table) {
  if (!table || typeof table !== "object") return table;
  const players = tablePlayers(table);
  table.players = players;
  table.maxSeats = Number(table.maxSeats || 6);
  if (!Number.isFinite(table.maxSeats) || table.maxSeats < 2) table.maxSeats = 6;
  table.maxSeats = Math.min(6, Math.max(2, Math.trunc(table.maxSeats)));
  table.player1 = players[0] || "";
  table.player2 = players[1] || "";
  table.status = table.status || (players.length >= 2 ? "waiting" : "waiting");
  table.stage = normalizeStage(table.stage) || "waiting";
  table.bots = table.bots && typeof table.bots === "object" ? table.bots : {};
  table.playerLabels = table.playerLabels && typeof table.playerLabels === "object" ? table.playerLabels : {};
  table.playerCards = table.playerCards && typeof table.playerCards === "object" ? table.playerCards : {};
  table.communityCards = Array.isArray(table.communityCards) ? table.communityCards : [];
  return table;
}

function tablePlayers(table) {
  const raw = [
    ...(Array.isArray(table?.players) ? table.players : []),
    table?.player1,
    table?.player2
  ];
  const players = [];
  const seen = new Set();
  for (const value of raw) {
    const player = normalizeAddress(value);
    if (!player || seen.has(player)) continue;
    seen.add(player);
    players.push(player);
  }
  return players.slice(0, 6);
}

function tableHasOpenSeat(table) {
  normalizePokerTable(table);
  return table.status !== "finished" && normalizeStage(table.stage) === "waiting" && table.players.length < table.maxSeats;
}

function addPlayerToTable(table, walletAddress) {
  normalizePokerTable(table);
  const player = normalizeAddress(walletAddress);
  if (!player) throw new Error("walletAddress required");
  if (table.players.some((seatPlayer) => sameAddress(seatPlayer, player))) return table;
  if (!tableHasOpenSeat(table)) throw new Error("Table is not open for new seats.");
  table.players.push(player);
  normalizePokerTable(table);
  table.updatedAt = new Date().toISOString();
  return table;
}

function dealDeckToPlayers(table, deck, players = tablePlayers(table)) {
  table.playerCards = {};
  for (let i = 0; i < players.length; i += 1) {
    table.playerCards[players[i]] = [deck[i], deck[i + players.length]];
  }
  table.communityCards = deck.slice(players.length * 2, players.length * 2 + 5);
}

async function firstOpenLobbyTable(context, lobby, walletAddress = "") {
  const player = normalizeAddress(walletAddress);
  for (const tableId of [...(lobby.tableIds || [])].reverse()) {
    const table = await readPokerTable(context, tableId);
    if (!table || !tableHasOpenSeat(table)) continue;
    if (player && isTablePlayer(table, player)) continue;
    return table;
  }
  return null;
}

async function firstOpenLobbyTableId(context, lobby) {
  const table = await firstOpenLobbyTable(context, lobby, "");
  return table?.id || "";
}

function normalizeLobby(lobby) {
  const value = lobby && typeof lobby === "object" ? lobby : {};
  const tableIds = Array.isArray(value.tableIds)
    ? value.tableIds.map(normalizeTableId).filter(Boolean).slice(-100)
    : [];
  const playerTables = {};
  if (value.playerTables && typeof value.playerTables === "object") {
    for (const [player, tableId] of Object.entries(value.playerTables)) {
      const walletAddress = normalizeAddress(player);
      const id = normalizeTableId(tableId);
      if (walletAddress && id) playerTables[walletAddress] = id;
    }
  }
  return {
    waitingTableId: normalizeTableId(value.waitingTableId) || "",
    tableIds,
    playerTables
  };
}

function trackTable(lobby, tableId) {
  const id = normalizeTableId(tableId);
  if (!id) return;
  lobby.tableIds = Array.isArray(lobby.tableIds) ? lobby.tableIds : [];
  lobby.tableIds = [...new Set([...lobby.tableIds, id])].slice(-100);
}

function trackPlayerTable(lobby, walletAddress, tableId) {
  const player = normalizeAddress(walletAddress);
  const id = normalizeTableId(tableId);
  if (!player || !id) return;
  lobby.playerTables = lobby.playerTables && typeof lobby.playerTables === "object" ? lobby.playerTables : {};
  lobby.playerTables[player] = id;
}

async function findPlayerTable(context, lobby, walletAddress, preferredTableId = "") {
  const player = normalizeAddress(walletAddress);
  if (!player) return null;

  const candidates = [];
  if (preferredTableId) candidates.push(preferredTableId);
  const mapped = normalizeTableId(lobby.playerTables?.[player]);
  if (mapped) candidates.push(mapped);
  if (lobby.waitingTableId) candidates.push(lobby.waitingTableId);
  for (const tableId of [...(lobby.tableIds || [])].reverse()) candidates.push(tableId);

  const seen = new Set();
  for (const candidate of candidates) {
    const id = normalizeTableId(candidate);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const table = await readPokerTable(context, id);
    if (table) normalizePokerTable(table);
    if (table && isTablePlayer(table, player) && table.status !== "finished" && normalizeStage(table.stage) !== "finished") {
      trackPlayerTable(lobby, player, table.id);
      return table;
    }
  }
  return null;
}

function adminTableSummary(table) {
  normalizePokerTable(table);
  return {
    id: table.id,
    status: table.status,
    stage: table.stage,
    player1: table.player1 || "",
    player2: table.player2 || "",
    players: table.players,
    maxSeats: table.maxSeats,
    openSeats: Math.max(0, table.maxSeats - table.players.length),
    playerLabels: table.playerLabels || {},
    simulation: Boolean(table.simulation),
    handId: Number(table.handId || table.fair?.handId || 0),
    fairReady: Boolean(table.fair?.seed),
    updatedAt: table.updatedAt
  };
}

function requireAdmin(context) {
  const expected = String(context.env.ADMIN_TOKEN || "");
  if (!expected) {
    return { ok: false, response: jsonResponse({ error: "Admin panel is disabled. Set ADMIN_TOKEN in environment variables." }, 503) };
  }

  const header = context.request.headers.get("authorization") || "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const token = bearer || context.request.headers.get("x-admin-token") || "";
  if (token !== expected) {
    return { ok: false, response: jsonResponse({ error: "Unauthorized" }, 401) };
  }

  return { ok: true };
}

function communityForStage(cards, stage) {
  if (!Array.isArray(cards)) return [];
  if (stage === "flop") return cards.slice(0, 3);
  if (stage === "turn") return cards.slice(0, 4);
  if (stage === "river" || stage === "showdown" || stage === "finished") return cards.slice(0, 5);
  return [];
}

function pickWinner(table) {
  const players = tablePlayers(table);
  const community = table.communityCards || [];
  let winner = players[0] || "";
  let bestScore = -1;
  for (const player of players) {
    const score = handScore([...(table.playerCards?.[player] || []), ...community]);
    if (score > bestScore) {
      winner = player;
      bestScore = score;
    }
  }
  return winner;
}

function handScore(cards) {
  return cards.reduce((score, card) => score + cardRank(card), 0);
}

function cardRank(card) {
  const rank = String(card || "").slice(0, -1);
  return { A: 14, K: 13, Q: 12, J: 11, T: 10 }[rank] || Number(rank) || 0;
}

function seedCommit(secret, playerAddress, tableId, handId) {
  return keccak256(
    solidityPacked(
      ["string", "address", "bytes32", "uint256"],
      [String(secret), normalizeAddress(playerAddress), normalizeTableId(tableId), BigInt(handId)]
    )
  );
}

function deckHash(deck) {
  return keccak256(toUtf8Bytes((deck || []).join("|")));
}

function zeroBytes32() {
  return `0x${"0".repeat(64)}`;
}

function normalizeBytes32(value) {
  const bytes32 = String(value || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(bytes32) ? bytes32.toLowerCase() : "";
}

function shuffleDeck(seed) {
  const deck = [];
  const suits = ["s", "h", "d", "c"];
  const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
  for (const rank of ranks) {
    for (const suit of suits) {
      deck.push(`${rank}${suit}`);
    }
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

function randomTableId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function tableKey(tableId) {
  return `poker:table:${normalizeTableId(tableId)}`;
}

function normalizeTableId(value) {
  const id = String(value || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(id) ? id.toLowerCase() : "";
}

function normalizeAddress(value) {
  const address = String(value || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(address) ? address.toLowerCase() : "";
}

function normalizeStage(value) {
  const stage = String(value || "").toLowerCase();
  return [
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
    "finished"
  ].includes(stage)
    ? stage
    : "";
}

function chatKey(room) {
  return `chat:${room}`;
}

function normalizeRoom(room) {
  const value = String(room || "").trim();
  if (/^table:0x[a-fA-F0-9]{64}$/.test(value)) return value.toLowerCase();
  return value === "table" ? "table" : "lobby";
}

function buildAccountAssociation(context) {
  if (
    context.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER &&
    context.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD &&
    context.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE
  ) {
    return {
      header: context.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER,
      payload: context.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD,
      signature: context.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE
    };
  }
  return null;
}

function appName(context) {
  return context.env.APP_NAME || "Poker Clash";
}

function appUrl(context) {
  return normalizeAppUrl(context.env.APP_URL || DEFAULT_APP_URL);
}

function gameContractAddress(context) {
  return context.env.GAME_CONTRACT_ADDRESS || context.env.ESCROW_CONTRACT_ADDRESS || "";
}

function baseChainId(context) {
  return Number(context.env.BASE_CHAIN_ID || 84532);
}

function canonicalDomain(context) {
  try {
    return new URL(appUrl(context)).host;
  } catch {
    return undefined;
  }
}

function normalizeAppUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function htmlResponse(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function jsResponse(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(stripUndefined(payload)), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttr(value) {
  return escapeHtmlText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
