const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { keccak256, solidityPacked, toUtf8Bytes } = require("ethers");
const { createStorage } = require("./storage");

try {
  require("dotenv").config();
} catch {
  // Production hosts usually inject env vars directly.
}

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const storage = createStorage({ root: ROOT });

const APP_NAME = process.env.APP_NAME || "Poker Clash";
const APP_URL = normalizeAppUrl(process.env.APP_URL || "https://your-domain.example");
const BASE_CHAIN_ID = Number(process.env.BASE_CHAIN_ID || 84532);
const BASE_RPC_URL = process.env.BASE_RPC_URL || process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const GAME_CONTRACT_ADDRESS = process.env.GAME_CONTRACT_ADDRESS || process.env.ESCROW_CONTRACT_ADDRESS || "";
const DEFAULT_STAKE_ETH = process.env.DEFAULT_STAKE_ETH || process.env.LOW_LIMIT_BUY_IN_ETH || "0.0001";
const DEFAULT_BET_ETH = process.env.DEFAULT_BET_ETH || process.env.LOW_LIMIT_ANTE_ETH || "0.00001";
const WAITING_TABLE_TTL_MS = 10 * 60 * 1000;
const FARCASTER_HOSTED_MANIFEST_ID = process.env.FARCASTER_HOSTED_MANIFEST_ID || "";
const FARCASTER_ACCOUNT_ASSOCIATION_HEADER =
  process.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER || "";
const FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD =
  process.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD || "";
const FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE =
  process.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        appName: APP_NAME,
        baseChainId: BASE_CHAIN_ID,
        gameContractConfigured: Boolean(GAME_CONTRACT_ADDRESS),
        chatKvConfigured: false,
        adminConfigured: Boolean(ADMIN_TOKEN),
        provablyFair: "commit-reveal-v1",
        game: "on-chain-poker-table"
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/config.js") {
      serveClientConfig(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/state") {
      serveAdminState(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/admin/")) {
      handleAdminAction(req, url, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/lobby/join") {
      handleLobbyJoin(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/lobby/tables") {
      serveLobbyTables(url, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/lobby/status") {
      serveLobbyStatus(url, res);
      return;
    }

    if (url.pathname.startsWith("/api/tables/")) {
      const parts = url.pathname.split("/");
      const tableId = parts[3];
      const action = parts[4];
      if (req.method === "GET" && tableId) {
        serveTableState(tableId, url, res);
        return;
      }
      if (req.method === "POST" && tableId && action === "sync") {
        handleTableSync(req, tableId, res);
        return;
      }
      if (req.method === "POST" && tableId && action === "fair") {
        handleFairAction(req, tableId, parts[5], res);
        return;
      }
      if (req.method === "POST" && tableId && action === "simulate") {
        handleTableSimulation(req, tableId, res);
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/api/chat") {
      serveChatMessages(url, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      handleChatMessage(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/.well-known/farcaster.json") {
      serveFarcasterManifest(req, res);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`${APP_NAME} running at http://${displayHost}:${PORT}`);
});

function serveStatic(req, res, url) {
  let requestPath = decodeURIComponent(url.pathname);
  if (requestPath === "/") {
    requestPath = "/index.html";
  }

  const safePath = path
    .normalize(requestPath)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  let body = fs.readFileSync(filePath);

  if (ext === ".html") {
    body = injectHtmlTemplate(body.toString("utf8"), req);
  }

  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=60"
  });
  res.end(body);
}

function serveAdminState(req, res) {
  if (!requireAdmin(req, res)) return;

  const state = storage.loadState();
  const lobby = normalizeLobby(state.pokerLobby);
  cleanupExpiredLobbyTables(state, lobby);
  state.pokerLobby = lobby;
  storage.saveState(state);
  const tables = lobby.tableIds
    .slice(-25)
    .map((tableId) => state.pokerTables?.[tableId])
    .filter(Boolean)
    .map(adminTableSummary)
    .reverse();

  sendJson(res, 200, {
    ok: true,
    waitingTableId: lobby.waitingTableId || "",
    tables
  });
}

function handleAdminAction(req, url, res) {
  if (!requireAdmin(req, res)) return;

  const action = url.pathname.replace(/^\/api\/admin\//, "");
  if (action === "bots/create-waiting") {
    adminCreateBotWaiting(res);
    return;
  }
  if (action === "bots/fill-waiting") {
    adminFillWaitingWithBot(res);
    return;
  }
  if (action === "reset-lobby") {
    adminResetLobby(res);
    return;
  }
  sendJson(res, 404, { error: "Unknown admin action" });
}

function adminCreateBotWaiting(res) {
  const state = storage.loadState();
  state.pokerLobby = normalizeLobby(state.pokerLobby);
  state.pokerTables = state.pokerTables || {};

  const bot = createBot();
  const table = createPokerTable(bot.address);
  markBotTable(table, bot);
  state.pokerLobby.waitingTableId = table.id;
  trackTable(state.pokerLobby, table.id);
  trackPlayerTable(state.pokerLobby, table.player1, table.id);
  state.pokerTables[table.id] = table;
  storage.saveState(state);
  sendJson(res, 200, { ok: true, bot, table: publicTable(table, "") });
}

function adminFillWaitingWithBot(res) {
  const state = storage.loadState();
  state.pokerLobby = normalizeLobby(state.pokerLobby);
  state.pokerTables = state.pokerTables || {};
  const waitingId = normalizeTableId(state.pokerLobby.waitingTableId);

  if (!waitingId) {
    adminCreateBotWaiting(res);
    return;
  }

  const table = state.pokerTables[waitingId];
  if (!table || !tableHasOpenSeat(table)) {
    adminCreateBotWaiting(res);
    return;
  }

  const bot = createBot();
  addPlayerToTable(table, bot.address);
  table.status = tablePlayers(table).length >= 2 ? "confirming" : "waiting";
  table.stage = table.status;
  table.updatedAt = new Date().toISOString();
  markBotTable(table, bot);
  dealTableCards(table);
  state.pokerLobby.waitingTableId = tableHasOpenSeat(table) ? table.id : "";
  trackTable(state.pokerLobby, table.id);
  for (const player of tablePlayers(table)) trackPlayerTable(state.pokerLobby, player, table.id);
  storage.saveState(state);
  sendJson(res, 200, { ok: true, bot, table: publicTable(table, "") });
}

function adminResetLobby(res) {
  const state = storage.loadState();
  state.pokerLobby = normalizeLobby(state.pokerLobby);
  state.pokerLobby.waitingTableId = "";
  storage.saveState(state);
  sendJson(res, 200, { ok: true, waitingTableId: "" });
}

function handleLobbyJoin(req, res) {
  readJsonBody(req)
    .then((body) => {
      const walletAddress = normalizeAddress(body.walletAddress);
      if (!walletAddress) {
        sendJson(res, 400, { error: "walletAddress required" });
        return;
      }

      const state = storage.loadState();
      state.pokerLobby = normalizeLobby(state.pokerLobby);
      state.pokerTables = state.pokerTables || {};
      cleanupExpiredLobbyTables(state, state.pokerLobby);

      let table = null;
      const requestedTableId = normalizeTableId(body.tableId);
      const existingTable = findPlayerTable(state, state.pokerLobby, walletAddress, requestedTableId);
      if (existingTable) {
        sendJson(res, 200, { table: publicTable(existingTable, walletAddress), restored: true });
        return;
      }

      if (requestedTableId && !body.create) {
        const requestedTable = state.pokerTables[requestedTableId];
        if (!requestedTable) {
          sendJson(res, 404, { error: "Table not found" });
          return;
        }
        if (!tableHasOpenSeat(requestedTable)) {
          sendJson(res, 409, { error: "Table is not open for new seats." });
          return;
        }
        addPlayerToTable(requestedTable, walletAddress);
        table = requestedTable;
      }

      if (!table && !body.create) {
        table = firstOpenLobbyTable(state, state.pokerLobby, walletAddress);
        if (table) addPlayerToTable(table, walletAddress);
      }

      if (!table) {
        table = createPokerTable(walletAddress);
        trackTable(state.pokerLobby, table.id);
      }

      if (table.bots && Object.keys(table.bots).length) {
        table.simulation = true;
        if (tablePlayers(table).length >= 2 && table.stage === "waiting") {
          table.status = "confirming";
          table.stage = "confirming";
          dealTableCards(table);
        }
      }
      trackTable(state.pokerLobby, table.id);
      for (const player of tablePlayers(table)) trackPlayerTable(state.pokerLobby, player, table.id);
      state.pokerLobby.waitingTableId = tableHasOpenSeat(table) ? table.id : firstOpenLobbyTableId(state, state.pokerLobby);
      state.pokerTables[table.id] = table;
      storage.saveState(state);
      sendJson(res, 200, { table: publicTable(table, walletAddress) });
    })
    .catch((error) => {
      const badRequest = error instanceof SyntaxError || error.message === "Body too large";
      if (!badRequest) console.error("Lobby join failed:", error.message);
      sendJson(res, badRequest ? 400 : 500, { error: badRequest ? "Bad JSON" : "Lobby unavailable" });
    });
}

function serveLobbyTables(url, res) {
  const state = storage.loadState();
  state.pokerLobby = normalizeLobby(state.pokerLobby);
  state.pokerTables = state.pokerTables || {};
  cleanupExpiredLobbyTables(state, state.pokerLobby);
  const viewer = normalizeAddress(url.searchParams.get("walletAddress"));
  const tables = [];
  for (const tableId of [...(state.pokerLobby.tableIds || [])].reverse()) {
    const table = state.pokerTables[tableId];
    if (!table) continue;
    normalizePokerTable(table);
    if (table.status === "finished" || normalizeStage(table.stage) === "finished") continue;
    tables.push(publicTable(table, viewer));
  }
  storage.saveState(state);
  sendJson(res, 200, { ok: true, tables: tables.slice(0, 50), waitingTableId: state.pokerLobby.waitingTableId || "" });
}

function serveLobbyStatus(url, res) {
  const walletAddress = normalizeAddress(url.searchParams.get("walletAddress"));
  if (!walletAddress) {
    sendJson(res, 400, { error: "walletAddress required" });
    return;
  }

  const state = storage.loadState();
  state.pokerLobby = normalizeLobby(state.pokerLobby);
  state.pokerTables = state.pokerTables || {};
  cleanupExpiredLobbyTables(state, state.pokerLobby);
  const table = findPlayerTable(state, state.pokerLobby, walletAddress, normalizeTableId(url.searchParams.get("tableId")));
  storage.saveState(state);
  sendJson(res, 200, {
    ok: true,
    table: table ? publicTable(table, walletAddress) : null,
    waitingTableId: state.pokerLobby.waitingTableId || ""
  });
}

function serveTableState(rawTableId, url, res) {
  const tableId = normalizeTableId(rawTableId);
  if (!tableId) {
    sendJson(res, 400, { error: "Bad table id" });
    return;
  }

  const state = storage.loadState();
  const table = state.pokerTables?.[tableId];
  if (!table) {
    sendJson(res, 404, { error: "Table not found" });
    return;
  }

  sendJson(res, 200, { table: publicTable(table, normalizeAddress(url.searchParams.get("player"))) });
}

function handleTableSync(req, rawTableId, res) {
  readJsonBody(req)
    .then((body) => {
      const tableId = normalizeTableId(rawTableId);
      if (!tableId) {
        sendJson(res, 400, { error: "Bad table id" });
        return;
      }

      const state = storage.loadState();
      const table = state.pokerTables?.[tableId];
      if (!table) {
        sendJson(res, 404, { error: "Table not found" });
        return;
      }

      const stage = normalizeStage(body.stage);
      if (stage) {
        table.stage = stage;
        table.status =
          stage === "finished" ? "finished" : stage === "waiting" ? "waiting" : stage === "confirming" ? "confirming" : "playing";
      }
      if (body.chainExists || stage) {
        table.onChain = true;
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
      storage.saveState(state);
      sendJson(res, 200, { table: publicTable(table, normalizeAddress(body.viewer || body.walletAddress)) });
    })
    .catch((error) => {
      const badRequest = error instanceof SyntaxError || error.message === "Body too large";
      if (!badRequest) console.error("Table sync failed:", error.message);
      sendJson(res, badRequest ? 400 : 500, { error: badRequest ? "Bad JSON" : "Table sync unavailable" });
    });
}

function handleFairAction(req, rawTableId, action, res) {
  const tableId = normalizeTableId(rawTableId);
  if (!tableId) {
    sendJson(res, 400, { error: "Bad table id" });
    return;
  }
  if (action !== "commit" && action !== "reveal") {
    sendJson(res, 404, { error: "Unknown provably fair action" });
    return;
  }

  readJsonBody(req)
    .then((body) => {
      const walletAddress = normalizeAddress(body.walletAddress);
      const state = storage.loadState();
      const table = state.pokerTables?.[tableId];
      if (!table) {
        sendJson(res, 404, { error: "Table not found" });
        return;
      }
      if (table.simulation) {
        sendJson(res, 400, { error: "Bot tables skip commit-reveal fairness." });
        return;
      }
      if (!walletAddress || !isTablePlayer(table, walletAddress)) {
        sendJson(res, 403, { error: "Only table players can update fair state." });
        return;
      }

      const handId = Number(body.handId || table.handId || 1);
      if (!Number.isSafeInteger(handId) || handId <= 0) {
        sendJson(res, 400, { error: "Bad hand id" });
        return;
      }
      ensureFairHand(table, handId);

      if (action === "commit") {
        const commit = normalizeBytes32(body.commit);
        if (!commit) {
          sendJson(res, 400, { error: "commit bytes32 required" });
          return;
        }
        table.fair.commits[walletAddress] = commit;
        table.updatedAt = new Date().toISOString();
        storage.saveState(state);
        sendJson(res, 200, { ok: true, table: publicTable(table, walletAddress) });
        return;
      }

      const secret = String(body.secret || "").trim();
      if (!secret) {
        sendJson(res, 400, { error: "secret required" });
        return;
      }
      const commit = table.fair.commits?.[walletAddress];
      if (!commit) {
        sendJson(res, 400, { error: "Commit first" });
        return;
      }
      const expected = seedCommit(secret, walletAddress, table.id, handId);
      if (expected.toLowerCase() !== commit.toLowerCase()) {
        sendJson(res, 400, { error: "Secret does not match commit" });
        return;
      }

      table.fair.reveals[walletAddress] = secret;

      if (tablePlayers(table).every((player) => table.fair.reveals[player])) {
        finalizeFairDeck(table);
      }

      table.updatedAt = new Date().toISOString();
      storage.saveState(state);
      sendJson(res, 200, { ok: true, table: publicTable(table, walletAddress) });
    })
    .catch((error) => {
      const badRequest = error instanceof SyntaxError || error.message === "Body too large";
      sendJson(res, badRequest ? 400 : 500, { error: badRequest ? "Bad JSON" : "Provably fair update unavailable" });
    });
}

function handleTableSimulation(req, rawTableId, res) {
  readJsonBody(req)
    .then((body) => {
      const tableId = normalizeTableId(rawTableId);
      if (!tableId) {
        sendJson(res, 400, { error: "Bad table id" });
        return;
      }

      const walletAddress = normalizeAddress(body.walletAddress);
      const state = storage.loadState();
      const table = state.pokerTables?.[tableId];
      if (!table) {
        sendJson(res, 404, { error: "Table not found" });
        return;
      }
      if (!table.simulation) {
        sendJson(res, 400, { error: "This table is not in bot simulation mode" });
        return;
      }
      if (!walletAddress || !isTablePlayer(table, walletAddress) || isBot(table, walletAddress)) {
        sendJson(res, 403, { error: "Only the human player can control this bot test table" });
        return;
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
          sendJson(res, 400, { error: error.message || "Bad simulation action" });
          return;
        }
      } else {
        sendJson(res, 400, { error: "Not your turn" });
        return;
      }

      table.updatedAt = new Date().toISOString();
      storage.saveState(state);
      sendJson(res, 200, { ok: true, table: publicTable(table, walletAddress) });
    })
    .catch((error) => {
      const badRequest = error instanceof SyntaxError || error.message === "Body too large";
      sendJson(res, badRequest ? 400 : 500, { error: badRequest ? "Bad JSON" : "Simulation unavailable" });
    });
}

function serveChatMessages(url, res) {
  const room = normalizeRoom(url.searchParams.get("room"));
  const state = storage.loadState();
  const messages = Array.isArray(state.chatMessages[room]) ? state.chatMessages[room] : [];
  sendJson(res, 200, { room, messages: messages.slice(-25) });
}

function handleChatMessage(req, res) {
  readJsonBody(req)
    .then((body) => {
      const room = normalizeRoom(body.room);
      const message = String(body.message || "").trim().slice(0, 180);
      const player = String(body.player || "guest").trim().slice(0, 32) || "guest";
      if (!message) {
        sendJson(res, 400, { error: "Message required" });
        return;
      }

      const state = storage.loadState();
      const messages = Array.isArray(state.chatMessages[room]) ? state.chatMessages[room] : [];
      messages.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        room,
        player,
        message,
        createdAt: new Date().toISOString()
      });
      state.chatMessages[room] = messages.slice(-100);
      storage.saveState(state);
      sendJson(res, 200, { ok: true, room, messages: state.chatMessages[room].slice(-25) });
    })
    .catch(() => {
      sendJson(res, 400, { error: "Bad JSON" });
    });
}

function normalizeRoom(room) {
  const value = String(room || "").trim();
  if (/^table:0x[a-fA-F0-9]{64}$/.test(value)) return value.toLowerCase();
  return value === "table" ? "table" : "lobby";
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
    stake: DEFAULT_STAKE_ETH,
    pot: "0",
    turn: "",
    onChain: false,
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

function finalizeFairDeck(table) {
  const players = tablePlayers(table);
  const secrets = players.map((player) => table.fair.reveals[player]);
  if (players.length < 2 || secrets.some((secret) => !secret)) return;
  const contract = normalizeAddress(GAME_CONTRACT_ADDRESS) || "0x0000000000000000000000000000000000000000";
  const seed = keccak256(
    solidityPacked(
      ["bytes32", "uint256", "uint256", "address", ...secrets.map(() => "string")],
      [table.id, BigInt(table.fair.handId), BigInt(BASE_CHAIN_ID), contract, ...secrets]
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
    stake: table.stake || DEFAULT_STAKE_ETH,
    pot: table.pot || "0",
    turn: table.turn || "",
    onChain: Boolean(table.onChain),
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
  const bytes = crypto.randomBytes(20);
  bytes[0] = 0xb0;
  return `0x${bytes.toString("hex")}`;
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
  table.status = table.status || "waiting";
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

function firstOpenLobbyTable(state, lobby, walletAddress = "") {
  const player = normalizeAddress(walletAddress);
  for (const tableId of [...(lobby.tableIds || [])].reverse()) {
    const table = state.pokerTables?.[tableId];
    if (!table || !tableHasOpenSeat(table)) continue;
    if (player && isTablePlayer(table, player)) continue;
    return table;
  }
  return null;
}

function firstOpenLobbyTableId(state, lobby) {
  return firstOpenLobbyTable(state, lobby, "")?.id || "";
}

function cleanupExpiredLobbyTables(state, lobby) {
  state.pokerTables = state.pokerTables || {};
  const keepIds = [];
  const removed = new Set();
  for (const tableId of lobby.tableIds || []) {
    const id = normalizeTableId(tableId);
    if (!id) continue;
    const table = state.pokerTables[id];
    if (!table) {
      removed.add(id);
      continue;
    }
    normalizePokerTable(table);
    if (isExpiredWaitingTable(table)) {
      delete state.pokerTables[id];
      removed.add(id);
      continue;
    }
    keepIds.push(id);
  }
  lobby.tableIds = [...new Set(keepIds)].slice(-100);
  if (removed.has(normalizeTableId(lobby.waitingTableId))) {
    lobby.waitingTableId = "";
  }
  if (!lobby.waitingTableId) {
    lobby.waitingTableId = firstOpenLobbyTableId(state, lobby);
  }
  const playerTables = {};
  for (const [player, tableId] of Object.entries(lobby.playerTables || {})) {
    const id = normalizeTableId(tableId);
    if (!id || removed.has(id) || !state.pokerTables[id]) continue;
    playerTables[player] = id;
  }
  lobby.playerTables = playerTables;
}

function isExpiredWaitingTable(table) {
  normalizePokerTable(table);
  if (table.onChain) return false;
  if (normalizeStage(table.stage) !== "waiting") return false;
  if (table.players.length >= 2) return false;
  const timestamp = Date.parse(table.updatedAt || table.createdAt || "");
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp > WAITING_TABLE_TTL_MS;
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

function findPlayerTable(state, lobby, walletAddress, preferredTableId = "") {
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
    const table = state.pokerTables?.[id];
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

function requireAdmin(req, res) {
  if (!ADMIN_TOKEN) {
    sendJson(res, 503, { error: "Admin panel is disabled. Set ADMIN_TOKEN in environment variables." });
    return false;
  }

  const header = req.headers.authorization || "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const token = bearer || req.headers["x-admin-token"] || "";
  if (token !== ADMIN_TOKEN) {
    sendJson(res, 401, { error: "Unauthorized" });
    return false;
  }

  return true;
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
  return `0x${crypto.randomBytes(32).toString("hex")}`;
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      chunks.push(buffer);
      size += buffer.length;
      if (size > 4096) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveClientConfig(req, res) {
  const appUrl = resolveAppUrl(req);
  const config = {
    appName: APP_NAME,
    appUrl,
    gameContractAddress: GAME_CONTRACT_ADDRESS,
    escrowAddress: GAME_CONTRACT_ADDRESS,
    defaultStakeEth: DEFAULT_STAKE_ETH,
    defaultBetEth: DEFAULT_BET_ETH,
    developerFeeBps: 200,
    maxSeats: 6,
    chain: {
      id: BASE_CHAIN_ID,
      hex: `0x${BASE_CHAIN_ID.toString(16)}`,
      name: BASE_CHAIN_ID === 8453 ? "Base" : "Base Sepolia",
      rpcUrl: BASE_RPC_URL,
      explorerUrl: BASE_CHAIN_ID === 8453 ? "https://basescan.org" : "https://sepolia-explorer.base.org"
    }
  };

  res.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(`window.MATH_CLASH_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
}

function injectHtmlTemplate(html, req) {
  const appUrl = resolveAppUrl(req);
  const miniAppEmbed = createMiniAppEmbed(appUrl);
  return html
    .replaceAll("__APP_NAME__", escapeHtmlText(APP_NAME))
    .replaceAll("__APP_URL__", escapeHtmlAttr(appUrl))
    .replaceAll("__MINIAPP_EMBED_JSON__", escapeHtmlAttr(JSON.stringify(miniAppEmbed)))
    .replaceAll("__FRAME_EMBED_JSON__", escapeHtmlAttr(JSON.stringify(miniAppEmbed)));
}

function serveFarcasterManifest(req, res) {
  const manifest = buildFarcasterManifest(req);
  sendJson(res, 200, manifest);
}

function buildFarcasterManifest(req) {
  const appUrl = resolveAppUrl(req);
  const accountAssociation = buildAccountAssociation();
  const manifest = {
    accountAssociation,
    miniapp: buildMiniAppManifest(req),
    frame: buildMiniAppManifest(req)
  };

  if (!accountAssociation) {
    delete manifest.accountAssociation;
  }

  if (FARCASTER_HOSTED_MANIFEST_ID) {
    manifest.miniapp.hostedManifestId = FARCASTER_HOSTED_MANIFEST_ID;
    manifest.frame.hostedManifestId = FARCASTER_HOSTED_MANIFEST_ID;
  }

  return {
    ...manifest,
    _debug: appUrl === "https://your-domain.example" ? "Set APP_URL before production deploy." : undefined
  };
}

function buildMiniAppManifest(req) {
  const appUrl = resolveAppUrl(req);
  const noindex =
    process.env.FARCASTER_NOINDEX === "true" ||
    (process.env.FARCASTER_NOINDEX !== "false" && BASE_CHAIN_ID !== 8453);

  return stripUndefined({
    version: "1",
    name: APP_NAME.slice(0, 32),
    homeUrl: appUrl,
    canonicalDomain: getCanonicalDomain(appUrl),
    iconUrl: `${appUrl}/assets/icon.png`,
    splashImageUrl: `${appUrl}/assets/splash.png`,
    splashBackgroundColor: "#111318",
    heroImageUrl: `${appUrl}/assets/og.png`,
    subtitle: "6-seat on-chain poker table",
    description: "Find a low-limit table, send real ETH into the pot, call or fold, and settle each hand on-chain.",
    tagline: "Find. Bet. Settle.",
    primaryCategory: "games",
    tags: ["poker", "bluff", "base", "pvp"],
    ogTitle: APP_NAME,
    ogDescription: "A six-seat poker table where every bet and call sends ETH into the hand pot.",
    ogImageUrl: `${appUrl}/assets/og.png`,
    requiredChains: [`eip155:${BASE_CHAIN_ID}`],
    requiredCapabilities: [
      "actions.ready",
      "actions.addMiniApp",
      "actions.composeCast",
      "wallet.getEthereumProvider"
    ],
    noindex
  });
}

function createMiniAppEmbed(appUrl) {
  return {
    version: "1",
    imageUrl: `${appUrl}/assets/og.png`,
    button: {
      title: `Play ${APP_NAME}`,
      action: {
        type: "launch_miniapp",
        name: APP_NAME,
        url: appUrl,
        splashImageUrl: `${appUrl}/assets/splash.png`,
        splashBackgroundColor: "#111318"
      }
    }
  };
}

function buildAccountAssociation() {
  if (
    FARCASTER_ACCOUNT_ASSOCIATION_HEADER &&
    FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD &&
    FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE
  ) {
    return {
      header: FARCASTER_ACCOUNT_ASSOCIATION_HEADER,
      payload: FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD,
      signature: FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE
    };
  }
  return null;
}

function resolveAppUrl(req) {
  if (APP_URL !== "https://your-domain.example") return APP_URL;
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
  return normalizeAppUrl(`${proto}://${host}`);
}

function normalizeAppUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getCanonicalDomain(appUrl) {
  try {
    return new URL(appUrl).host;
  } catch {
    return undefined;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(stripUndefined(payload)));
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
