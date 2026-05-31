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
      game: "on-chain-poker-table",
      runtime: "cloudflare-pages"
    });
  }

  if (url.pathname === "/api/lobby/join" && context.request.method === "POST") {
    return joinLobby(context);
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
  const waitingId = lobby.waitingTableId;

  if (waitingId) {
    const waitingTable = await readPokerTable(context, waitingId);
    if (
      waitingTable &&
      waitingTable.status === "waiting" &&
      normalizeAddress(waitingTable.player1) !== walletAddress
    ) {
      table = waitingTable;
      table.player2 = walletAddress;
      table.status = "confirming";
      table.stage = "confirming";
      table.updatedAt = new Date().toISOString();
      table.deck = table.deck || shuffleDeck(`${table.id}:${table.createdAt}`);
      dealTableCards(table);
      lobby.waitingTableId = "";
    }
  }

  if (!table) {
    table = createPokerTable(walletAddress);
    lobby.waitingTableId = table.id;
  }

  await writePokerTable(context, table);
  await writeLobby(context, lobby);
  return jsonResponse({ table: publicTable(table, walletAddress) });
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

  const player1 = normalizeAddress(body.player1);
  const player2 = normalizeAddress(body.player2);
  if (player1) table.player1 = player1;
  if (player2) table.player2 = player2;

  const winner = normalizeAddress(body.winner);
  if (winner) table.winner = winner;
  if (table.stage === "showdown" && !table.winner) {
    table.winner = pickWinner(table);
  }

  table.updatedAt = new Date().toISOString();
  await writePokerTable(context, table);
  return jsonResponse({ table: publicTable(table, normalizeAddress(body.viewer || body.walletAddress)) });
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
    maxSeats: 2,
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
    subtitle: "1v1 on-chain poker table",
    description: "Find a low-limit table, send real ETH into the pot, call or fold, and settle each hand on-chain.",
    tagline: "Find. Bet. Settle.",
    primaryCategory: "games",
    tags: ["poker", "bluff", "base", "pvp"],
    ogTitle: appName(context),
    ogDescription: "A two-player poker table where every bet and call sends ETH into the hand pot.",
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
  return lobby && typeof lobby === "object" ? lobby : { waitingTableId: "" };
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
  return {
    id,
    status: "waiting",
    stage: "waiting",
    player1: walletAddress,
    player2: "",
    stake: "0.0001",
    winner: "",
    deck: shuffleDeck(`${id}:${now}`),
    playerCards: {},
    communityCards: [],
    createdAt: now,
    updatedAt: now
  };
}

function dealTableCards(table) {
  if (!table.player1 || !table.player2 || table.communityCards?.length) return;
  const deck = Array.isArray(table.deck) && table.deck.length >= 9 ? table.deck : shuffleDeck(table.id);
  table.playerCards = {
    [normalizeAddress(table.player1)]: [deck[0], deck[2]],
    [normalizeAddress(table.player2)]: [deck[1], deck[3]]
  };
  table.communityCards = deck.slice(4, 9);
}

function publicTable(table, viewer) {
  const stage = normalizeStage(table.stage) || "waiting";
  const visibleCommunity = communityForStage(table.communityCards || [], stage);
  const playerCards = viewer && table.playerCards ? table.playerCards[viewer] || [] : [];
  return {
    id: table.id,
    status: table.status,
    stage,
    player1: table.player1 || "",
    player2: table.player2 || "",
    stake: table.stake || "0.0001",
    winner: table.winner || "",
    playerCards,
    communityCards: visibleCommunity,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    prototypeNotice: "Card dealing is off-chain in this prototype and not fully trustless yet."
  };
}

function communityForStage(cards, stage) {
  if (!Array.isArray(cards)) return [];
  if (stage === "flop") return cards.slice(0, 3);
  if (stage === "turn") return cards.slice(0, 4);
  if (stage === "river" || stage === "showdown" || stage === "finished") return cards.slice(0, 5);
  return [];
}

function pickWinner(table) {
  const p1 = normalizeAddress(table.player1);
  const p2 = normalizeAddress(table.player2);
  const community = table.communityCards || [];
  const score1 = handScore([...(table.playerCards?.[p1] || []), ...community]);
  const score2 = handScore([...(table.playerCards?.[p2] || []), ...community]);
  return score1 >= score2 ? p1 : p2;
}

function handScore(cards) {
  return cards.reduce((score, card) => score + cardRank(card), 0);
}

function cardRank(card) {
  const rank = String(card || "").slice(0, -1);
  return { A: 14, K: 13, Q: 12, J: 11, T: 10 }[rank] || Number(rank) || 0;
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
  return ["waiting", "confirming", "preflop", "flop", "turn", "river", "showdown", "finished"].includes(stage)
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
