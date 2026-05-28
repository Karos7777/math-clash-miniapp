const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createStorage, normalizeState } = require("./storage");

try {
  require("dotenv").config();
} catch {
  // Production hosts usually inject env vars directly.
}

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = process.env.MATH_CLASH_STATE_FILE || path.join(DATA_DIR, "state.json");

const APP_NAME = process.env.APP_NAME || "Brain Clash";
const APP_URL = normalizeAppUrl(process.env.APP_URL || "https://your-domain.example");
const DEV_MODE = process.env.DEV_MODE === "true" || process.env.NODE_ENV !== "production";
const FARCASTER_HOSTED_MANIFEST_ID = process.env.FARCASTER_HOSTED_MANIFEST_ID || "";
const FARCASTER_ACCOUNT_ASSOCIATION_HEADER =
  process.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER || "";
const FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD =
  process.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD || "";
const FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE =
  process.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE || "";

const BASE_CHAIN_ID = Number(process.env.BASE_CHAIN_ID || 84532);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TOKENS = {
  ETH: {
    label: "ETH",
    entryFee: "0.0001",
    entryUnits: 100000000000000n,
    decimals: 18
  },
  USDC: {
    label: "USDC",
    entryFee: "0.1",
    entryUnits: 100000n,
    decimals: 6
  },
  USDT: {
    label: "USDT",
    entryFee: "0.1",
    entryUnits: 100000n,
    decimals: 6
  }
};
const ENTRY_FEE = TOKENS.ETH.entryFee;
const ENTRY_FEE_UNITS = TOKENS.ETH.entryUnits;
const DEVELOPER_FEE_BPS = 400n;
const BPS_DENOMINATOR = 10000n;
const MATCHMAKING_TIMEOUT_MS = 48 * 60 * 60 * 1000;
const ESCROW_CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || "";
const ESCROW_RESOLVER_PRIVATE_KEY = process.env.ESCROW_RESOLVER_PRIVATE_KEY || "";
const DEFAULT_BASE_RPC_URL =
  BASE_CHAIN_ID === 84532 ? "https://sepolia.base.org" : "https://mainnet.base.org";
const BASE_RPC_URL = process.env.BASE_RPC_URL || DEFAULT_BASE_RPC_URL;

const DIFFICULTIES = {
  easy: {
    label: "Easy",
    durationSec: 45,
    questionCount: 12,
    min: 1,
    max: 24,
    ops: ["+", "-"],
    botPaceMs: 3300,
    botAccuracy: 0.78
  },
  medium: {
    label: "Medium",
    durationSec: 55,
    questionCount: 15,
    min: 2,
    max: 72,
    ops: ["+", "-", "*"],
    botPaceMs: 3800,
    botAccuracy: 0.72
  },
  hard: {
    label: "Hard",
    durationSec: 70,
    questionCount: 18,
    min: 3,
    max: 144,
    ops: ["+", "-", "*", "/"],
    botPaceMs: 4600,
    botAccuracy: 0.64
  }
};

const GAME_MODES = {
  math: {
    label: "Math Clash",
    questionType: "math"
  },
  quiz: {
    label: "Quiz Clash",
    questionType: "quiz"
  }
};

const QUIZ_CATEGORIES = {
  crypto: {
    label: "Crypto",
    questions: [
      { expression: "What network is this test app using right now?", answer: "Base Sepolia" },
      { expression: "What token is used for native gas on Base?", answer: "ETH" },
      { expression: "What does an escrow contract hold?", answer: "funds" }
    ]
  },
  gaming: {
    label: "Gaming",
    questions: [
      { expression: "In games, what does PvP mean?", answer: "player versus player" },
      { expression: "What do you call a ranked player list?", answer: "leaderboard" },
      { expression: "What word means a tied result?", answer: "draw" }
    ]
  },
  logic: {
    label: "Logic",
    questions: [
      { expression: "What comes next: 2, 4, 8, 16?", answer: "32" },
      { expression: "If all Bloops are Razzies and all Razzies are Lazzies, are Bloops Lazzies?", answer: "yes" },
      { expression: "Which is larger: 0.9 or 0.11?", answer: "0.9" }
    ]
  },
  culture: {
    label: "Culture",
    questions: [
      { expression: "What color do you get by mixing red and blue?", answer: "purple" },
      { expression: "How many days are in a leap year?", answer: "366" },
      { expression: "What planet is known as the Red Planet?", answer: "mars" }
    ]
  }
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const storage = createStorage({ root: ROOT, dataDir: DATA_DIR, stateFile: STATE_FILE });
let state = loadState();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/.well-known/farcaster.json") {
      serveFarcasterManifest(req, res);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error(error);
    }
    sendJson(res, statusCode, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`${APP_NAME} running at http://${displayHost}:${PORT}`);
});

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      baseChainId: BASE_CHAIN_ID,
      entryFee: ENTRY_FEE,
      modes: GAME_MODES,
      quizCategories: publicQuizCategories(),
      devMode: DEV_MODE,
      storage: storage.info(),
      difficulties: Object.fromEntries(
        Object.entries(DIFFICULTIES).map(([key, value]) => [
          key,
          {
            label: value.label,
            durationSec: value.durationSec,
            questionCount: value.questionCount
          }
        ])
      )
    });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/api/me" || url.pathname === "/api/match/status")) {
    const identity = resolveIdentity(Object.fromEntries(url.searchParams.entries()));
    const player = identity ? ensurePlayerProfile(identity) : null;
    const match = identity ? findLatestMatchForIdentity(identity) : null;
    if (match) tickMatch(match);
    const response = buildMeResponse(identity, player, match);
    saveState();
    sendJson(res, 200, response);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/leaderboard") {
    const sort = url.searchParams.get("sort") === "worst" ? "worst" : "top";
    const search = url.searchParams.get("search") || "";
    sendJson(res, 200, {
      leaderboard: buildLeaderboard({ sort, search }),
      sort,
      search,
      updatedAt: new Date().toISOString()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/chat") {
    sendJson(res, 200, {
      messages: buildChatMessages(),
      lastMessage: buildChatMessages(1)[0] || null
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson(req);
    const identity = resolveIdentity(body);
    const message = addChatMessage(identity, body);
    saveState();
    sendJson(res, 200, {
      message,
      messages: buildChatMessages(),
      lastMessage: message
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tasks") {
    const identity = resolveIdentity(Object.fromEntries(url.searchParams.entries()));
    const player = identity ? ensurePlayerProfile(identity) : null;
    sendJson(res, 200, {
      tasks: buildTaskViews(player?.id),
      xpEvents: player ? buildXpHistory(player.id) : [],
      player,
      devMode: DEV_MODE
    });
    return;
  }

  const taskClaim = url.pathname.match(/^\/api\/tasks\/([^/]+)\/claim$/);
  if (req.method === "POST" && taskClaim) {
    const body = await readJson(req);
    const identity = resolveIdentity(body);
    if (!identity) {
      throwHttp(400, "A Farcaster fid, wallet, or dev player id is required");
    }

    const response = claimTask(taskClaim[1], identity, body);
    saveState();
    sendJson(res, 200, response);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/stats/")) {
    const wallet = decodeURIComponent(url.pathname.replace("/api/stats/", ""));
    sendJson(res, 200, {
      stats: state.stats[walletKey(wallet)] || createEmptyStats(wallet)
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/matches/join") {
    const body = await readJson(req);
    const response = joinMatch(body);
    saveState();
    sendJson(res, 200, response);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/matches/reserve") {
    const body = await readJson(req);
    const response = reservePaidMatch(body);
    saveState();
    sendJson(res, 200, response);
    return;
  }

  const matchAnswer = url.pathname.match(/^\/api\/matches\/([^/]+)\/answer$/);
  if (req.method === "POST" && matchAnswer) {
    const match = getMatchOrThrow(matchAnswer[1]);
    const body = await readJson(req);
    const result = submitAnswer(match, body);
    tickMatch(match);
    saveState();
    sendJson(res, 200, result);
    return;
  }

  const matchFinish = url.pathname.match(/^\/api\/matches\/([^/]+)\/finish$/);
  if (req.method === "POST" && matchFinish) {
    const match = getMatchOrThrow(matchFinish[1]);
    const body = await readJson(req);
    const player = match.players[body.playerId];
    if (!player) {
      sendJson(res, 404, { error: "Player not found" });
      return;
    }
    const identity = resolveIdentity(body);
    if (!identity || !playerMatchesIdentity(player, identity)) {
      sendJson(res, 403, { error: "Player identity does not match this match seat" });
      return;
    }

    player.finishedAt = Date.now();
    tickMatch(match);
    saveState();
    sendJson(res, 200, viewMatch(match, body.playerId));
    return;
  }

  const matchReady = url.pathname.match(/^\/api\/matches\/([^/]+)\/ready$/);
  if (req.method === "POST" && matchReady) {
    const match = getMatchOrThrow(matchReady[1]);
    const body = await readJson(req);
    const response = markPlayerReady(match, body);
    saveState();
    sendJson(res, 200, response);
    return;
  }

  const matchSettle = url.pathname.match(/^\/api\/matches\/([^/]+)\/settle$/);
  if (req.method === "POST" && matchSettle) {
    if (!canUseSettlementAdmin(req)) {
      sendJson(res, 403, { error: "Settlement admin is not allowed from this request" });
      return;
    }

    const match = getMatchOrThrow(matchSettle[1]);
    if (match.status !== "finished") {
      sendJson(res, 400, { error: "Match is not finished" });
      return;
    }

    await settleEscrow(match);
    saveState();
    sendJson(res, 200, viewMatch(match, url.searchParams.get("playerId")));
    return;
  }

  const matchRefund = url.pathname.match(/^\/api\/matches\/([^/]+)\/refund$/);
  if (req.method === "POST" && matchRefund) {
    const match = getMatchOrThrow(matchRefund[1]);
    const body = await readJson(req);
    const response = markMatchRefunded(match, body);
    saveState();
    sendJson(res, 200, response);
    return;
  }

  const matchView = url.pathname.match(/^\/api\/matches\/([^/]+)$/);
  if (req.method === "GET" && matchView) {
    const match = getMatchOrThrow(matchView[1]);
    const playerId = url.searchParams.get("playerId");
    tickMatch(match);
    const response = viewMatch(match, playerId);
    saveState();
    sendJson(res, 200, response);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/dev/reset") {
    if (!DEV_MODE) {
      throwHttp(403, "Dev reset is disabled in production");
    }

    state = normalizeState({
      matches: {},
      stats: {},
      chatMessages: state.chatMessages,
      players: {},
      xpEvents: {},
      socialTasks: state.socialTasks,
      taskClaims: {}
    });
    saveState();
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

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

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    if (path.basename(filePath) === "index.html") {
      serveIndexHtml(req, res, filePath);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": [".html", ".js", ".css", ".json"].includes(ext)
        ? "no-store"
        : "public, max-age=3600"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function serveIndexHtml(req, res, filePath) {
  const html = fs
    .readFileSync(filePath, "utf8")
    .replaceAll("__APP_NAME__", escapeHtmlText(APP_NAME))
    .replaceAll("__APP_URL__", escapeHtmlAttr(resolveAppUrl(req)))
    .replaceAll("__MINIAPP_EMBED_JSON__", escapeHtmlAttr(JSON.stringify(buildMiniAppEmbed(req))))
    .replaceAll("__FRAME_EMBED_JSON__", escapeHtmlAttr(JSON.stringify(buildFrameEmbed(req))));

  res.writeHead(200, {
    "Content-Type": MIME_TYPES[".html"],
    "Cache-Control": "no-store"
  });
  res.end(html);
}

function serveFarcasterManifest(req, res) {
  if (FARCASTER_HOSTED_MANIFEST_ID) {
    res.writeHead(307, {
      Location: `https://api.farcaster.xyz/miniapps/hosted-manifest/${encodeURIComponent(
        FARCASTER_HOSTED_MANIFEST_ID
      )}`,
      "Cache-Control": "no-store"
    });
    res.end();
    return;
  }

  sendJson(res, 200, buildFarcasterManifest(req));
}

function buildFarcasterManifest(req) {
  const appUrl = resolveAppUrl(req);
  const miniapp = buildMiniAppManifest(req);
  const manifest = { miniapp };
  const accountAssociation = buildAccountAssociation();
  const baseBuilderOwner = process.env.BASE_BUILDER_OWNER_ADDRESS || "";

  if (accountAssociation) {
    manifest.accountAssociation = accountAssociation;
  }

  if (ethersAddressLike(baseBuilderOwner)) {
    manifest.baseBuilder = {
      ownerAddress: baseBuilderOwner
    };
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
    subtitle: "1v1 brain battles",
    description: "Solve math or quiz rounds faster than your rival and settle escrow payouts on Base.",
    tagline: "Think fast. Win escrow.",
    primaryCategory: "games",
    tags: ["quiz", "math", "base", "pvp"],
    ogTitle: APP_NAME,
    ogDescription: "Fast 1v1 brain battles with Base escrow payouts.",
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

function buildMiniAppEmbed(req) {
  const appUrl = resolveAppUrl(req);

  return {
    version: "1",
    imageUrl: `${appUrl}/assets/og.png`,
    button: {
      title: "Start Clash",
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

function buildFrameEmbed(req) {
  const appUrl = resolveAppUrl(req);

  return {
    version: "1",
    imageUrl: `${appUrl}/assets/og.png`,
    button: {
      title: "Start Clash",
      action: {
        type: "launch_frame",
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
    !FARCASTER_ACCOUNT_ASSOCIATION_HEADER ||
    !FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD ||
    !FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE
  ) {
    return null;
  }

  return {
    header: FARCASTER_ACCOUNT_ASSOCIATION_HEADER,
    payload: FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD,
    signature: FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE
  };
}

function resolveAppUrl(req) {
  if (APP_URL && APP_URL !== "https://your-domain.example") return APP_URL;

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || req.headers.host || `localhost:${PORT}`;
  const protocol = forwardedProto || (host.startsWith("localhost") ? "http" : "https");

  return normalizeAppUrl(`${protocol}://${host}`);
}

function normalizeAppUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function getCanonicalDomain(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
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

function ethersAddressLike(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function buildMeResponse(identity, player, match) {
  return {
    devMode: DEV_MODE,
    identity: identity
      ? {
          source: identity.source,
          key: identity.key,
          fid: identity.fid,
          walletAddress: identity.walletAddress,
          devPlayerId: identity.devPlayerId
        }
      : null,
    player,
    xp: player ? buildXpSummary(player.id) : null,
    xpEvents: player ? buildXpHistory(player.id) : [],
    tasks: buildTaskViews(player?.id),
    matchStatus: match ? getPersistentMatchStatus(match) : "none",
    match: match ? viewMatch(match, findPlayerIdInMatch(match, identity)) : null
  };
}

function resolveIdentity(input = {}) {
  const fid = sanitizeFid(input.fid || input.farcasterFid);
  const walletAddress = sanitizeWalletAddress(input.walletAddress || input.wallet);
  const devPlayerId = DEV_MODE ? sanitizeDevPlayerId(input.devPlayerId) : "";
  const username = sanitizeName(input.username || input.displayName || "");

  if (fid) {
    return {
      source: "fid",
      key: `fid:${fid}`,
      fid,
      walletAddress,
      username,
      devPlayerId: ""
    };
  }

  if (walletAddress) {
    return {
      source: "wallet",
      key: `wallet:${walletAddress.toLowerCase()}`,
      fid: null,
      walletAddress,
      username,
      devPlayerId: ""
    };
  }

  if (devPlayerId) {
    return {
      source: "dev",
      key: `dev:${devPlayerId}`,
      fid: null,
      walletAddress: "",
      username: devPlayerId,
      devPlayerId
    };
  }

  return null;
}

function ensurePlayerProfile(identity) {
  const now = new Date().toISOString();
  const existing = state.players[identity.key];
  const player = existing || {
    id: identity.key,
    fid: identity.fid || null,
    walletAddress: identity.walletAddress || "",
    username: identity.username || null,
    xp: 0,
    createdAt: now,
    updatedAt: now
  };

  player.fid = identity.fid || player.fid || null;
  player.walletAddress = identity.walletAddress || player.walletAddress || "";
  player.username = identity.username || player.username || null;
  player.updatedAt = now;
  state.players[player.id] = player;
  return player;
}

function findLatestMatchForIdentity(identity) {
  const matches = Object.values(state.matches).filter((match) =>
    Object.values(match.players || {}).some((player) => playerMatchesIdentity(player, identity))
  );

  matches.forEach(syncMatchRecord);
  return matches.sort((a, b) => getMatchSortTime(b) - getMatchSortTime(a))[0] || null;
}

function playerMatchesIdentity(player, identity) {
  if (!player || !identity) return false;
  if (player.identityKey === identity.key || player.profileId === identity.key) return true;
  if (identity.fid && Number(player.fid) === Number(identity.fid)) return true;
  if (identity.walletAddress && player.walletKey === walletKey(identity.walletAddress)) return true;
  if (identity.devPlayerId && player.devPlayerId === identity.devPlayerId) return true;
  return false;
}

function findPlayerIdInMatch(match, identity) {
  const entry = Object.entries(match.players || {}).find(([, player]) =>
    playerMatchesIdentity(player, identity)
  );
  return entry?.[0] || null;
}

function getMatchSortTime(match) {
  return Number(match.updatedAt || match.finishedAt || match.startedAt || match.createdAt || 0);
}

function getPersistentMatchStatus(match) {
  if (!match) return "none";
  if (match.lifecycleStatus === "refunded" || match.status === "refunded") return "refunded";
  if (match.status === "finished") {
    return match.payment?.settlement?.txHash ? "settled" : "finished";
  }
  if (match.status === "active") return "playing";
  if (match.status === "matched") return "matched";
  if (match.status === "funding") return "matched";
  if (match.status === "waiting") return "searching";
  return match.status || "none";
}

function syncMatchRecord(match) {
  if (!match) return match;
  const orderedPlayers = (match.order || []).map((id) => match.players[id]).filter(Boolean);
  const player1 = orderedPlayers[0] || null;
  const player2 = orderedPlayers[1] || null;
  const winner = match.result?.winnerId ? match.players[match.result.winnerId] : null;

  match.lifecycleStatus = getPersistentMatchStatus(match);
  match.player1Id = player1?.profileId || player1?.identityKey || player1?.walletKey || null;
  match.player2Id = player2?.profileId || player2?.identityKey || player2?.walletKey || null;
  match.player1Wallet = player1 && !player1.isBot ? player1.wallet : null;
  match.player2Wallet = player2 && !player2.isBot ? player2.wallet : null;
  match.escrowGameId = match.payment?.escrowId || null;
  match.stakeAmount = match.payment?.entryFee || null;
  match.chainId = BASE_CHAIN_ID;
  match.contractAddress = ESCROW_CONTRACT_ADDRESS || null;
  match.winnerPlayerId = winner?.profileId || winner?.identityKey || null;
  match.settlementTx = match.payment?.settlement?.txHash || null;
  match.updatedAt = match.updatedAt || match.createdAt || Date.now();
  return match;
}

function buildXpSummary(playerId) {
  const player = state.players[playerId];
  const xp = Number(player?.xp || 0);
  return {
    total: xp,
    level: xpToLevel(xp),
    nextLevelAt: xpToNextLevel(xp),
    note: "XP may be used for future rewards if the project continues."
  };
}

function buildXpHistory(playerId) {
  return Object.values(state.xpEvents)
    .filter((event) => event.playerId === playerId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20);
}

function buildTaskViews(playerId) {
  return Object.values(state.socialTasks)
    .filter((task) => task.active)
    .map((task) => {
      const claims = Object.values(state.taskClaims)
        .filter((claim) => claim.playerId === playerId && claim.taskId === task.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return {
        ...task,
        latestClaim: claims[0] || null
      };
    });
}

function claimTask(taskId, identity, body) {
  const task = state.socialTasks[taskId];
  if (!task || !task.active) {
    throwHttp(404, "Quest not found");
  }

  const player = ensurePlayerProfile(identity);
  if (!task.repeatable) {
    const existing = Object.values(state.taskClaims).find(
      (claim) => claim.playerId === player.id && claim.taskId === task.id
    );
    if (existing) {
      return {
        claim: existing,
        player,
        devMode: DEV_MODE,
        xp: buildXpSummary(player.id),
        xpEvents: buildXpHistory(player.id),
        tasks: buildTaskViews(player.id)
      };
    }
  }

  const now = new Date().toISOString();
  const claim = {
    id: createId("claim"),
    playerId: player.id,
    taskId: task.id,
    status: "pending",
    proofUrl: sanitizeUrl(body.proofUrl || body.castUrl || ""),
    castHash: sanitizeText(body.castHash || "", 120),
    createdAt: now,
    updatedAt: now
  };

  state.taskClaims[claim.id] = claim;
  return {
    claim,
    player,
    devMode: DEV_MODE,
    xp: buildXpSummary(player.id),
    xpEvents: buildXpHistory(player.id),
    tasks: buildTaskViews(player.id)
  };
}

function addChatMessage(identity, body) {
  const text = sanitizeChatMessage(body.message || body.text || "");
  if (!text) {
    throwHttp(400, "Message is required");
  }

  const player = identity ? ensurePlayerProfile(identity) : null;
  const message = {
    id: createId("chat"),
    playerId: player?.id || null,
    display: player?.username || shortWallet(identity?.walletAddress || "") || "Guest",
    text,
    createdAt: new Date().toISOString()
  };
  state.chatMessages[message.id] = message;

  const all = Object.values(state.chatMessages).sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );
  all.slice(100).forEach((oldMessage) => {
    delete state.chatMessages[oldMessage.id];
  });

  return message;
}

function buildChatMessages(limit = 30) {
  return Object.values(state.chatMessages || {})
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

function awardXp(playerId, type, amount, metadata = {}, options = {}) {
  if (!playerId || !state.players[playerId]) return null;
  const dedupeKey = options.dedupeKey || `${type}:${metadata.matchId || ""}`;
  const alreadyAwarded = Object.values(state.xpEvents).some(
    (event) => event.playerId === playerId && event.type === type && event.dedupeKey === dedupeKey
  );
  if (alreadyAwarded) return null;

  const now = new Date().toISOString();
  const event = {
    id: createId("xp"),
    playerId,
    type,
    amount,
    metadata,
    dedupeKey,
    createdAt: now
  };
  state.xpEvents[event.id] = event;
  state.players[playerId].xp = Number(state.players[playerId].xp || 0) + amount;
  state.players[playerId].updatedAt = now;
  return event;
}

function awardMatchEntryXp(player) {
  if (!player?.profileId || player.isBot || player.demo) return;
  awardXp(player.profileId, "play_first_match", 10, {}, { dedupeKey: "play_first_match" });
  awardXp(
    player.profileId,
    "daily_first_match",
    10,
    { day: currentUtcDay() },
    { dedupeKey: currentUtcDay() }
  );
}

function awardFinishedMatchXp(match, player, won) {
  if (!player?.profileId || player.isBot || player.demo) return;
  awardXp(player.profileId, "finish_match", 10, { matchId: match.id }, { dedupeKey: match.id });
  if (won) {
    awardXp(player.profileId, "win_match", 25, { matchId: match.id }, { dedupeKey: match.id });
  }
}

function xpToLevel(xp) {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1);
}

function xpToNextLevel(xp) {
  const nextLevel = xpToLevel(xp) + 1;
  return (nextLevel - 1) * (nextLevel - 1) * 100;
}

function currentUtcDay() {
  return new Date().toISOString().slice(0, 10);
}

function markMatchRefunded(match, body) {
  const identity = resolveIdentity(body);
  const playerId = String(body.playerId || findPlayerIdInMatch(match, identity) || "");
  const player = match.players[playerId];
  if (!player) {
    throwHttp(404, "Player not found");
  }

  if (match.status !== "waiting" && match.status !== "funding") {
    throwHttp(400, "Only unmatched matches can be marked refunded");
  }

  match.status = "refunded";
  match.lifecycleStatus = "refunded";
  match.refundTxHash = sanitizeTxHash(body.txHash);
  match.updatedAt = Date.now();
  return viewMatch(match, playerId);
}

function markPlayerReady(match, body) {
  if (!["matched", "active"].includes(match.status)) {
    throwHttp(400, "Match is not ready for player start");
  }

  const identity = resolveIdentity(body);
  const playerId = String(body.playerId || "");
  const player = match.players[playerId];
  if (!player) {
    throwHttp(404, "Player not found");
  }
  if (!identity || !playerMatchesIdentity(player, identity)) {
    throwHttp(403, "Player identity does not match this match seat");
  }

  startPlayerRun(match, player);
  match.updatedAt = Date.now();
  return viewMatch(match, playerId);
}

function joinMatch(body) {
  const difficulty = DIFFICULTIES[body.difficulty] ? body.difficulty : "medium";
  const mode = normalizeMode(body.mode);
  const quizCategories = normalizeQuizCategories(body.quizCategories, mode);
  const token = normalizeToken(body.token);
  const wallet = sanitizeWallet(body.wallet);
  const txHash = sanitizeTxHash(body.txHash);
  const demo = Boolean(body.demo);
  const identity = resolveIdentity({ ...body, wallet });
  const profile = identity ? ensurePlayerProfile(identity) : null;

  if (!demo) {
    return confirmPaidMatch({ ...body, difficulty, token, txHash, identity, profile });
  }

  cleanupWaitingMatches();

  const player = createPlayer({
    wallet,
    identity,
    profile,
    demo,
    token,
    txHash,
    paid: true,
    name: body.name || shortWallet(wallet)
  });

  const waiting = Object.values(state.matches).find(
    (match) =>
      match.status === "waiting" &&
      match.difficulty === difficulty &&
      (match.mode || "math") === mode &&
      match.payment?.mode === "demo" &&
      (mode !== "quiz" || quizCategoryIntersection(match.quizCategories, quizCategories).length > 0) &&
      !match.players[player.id] &&
      !Object.values(match.players).some((existing) => existing.walletKey === player.walletKey)
  );

  if (waiting) {
    if (mode === "quiz") {
      const intersection = quizCategoryIntersection(waiting.quizCategories, quizCategories);
      waiting.quizCategories = intersection;
      waiting.quizCategory = pickQuizCategory(intersection);
      waiting.questions = createQuestions({
        mode,
        difficulty,
        quizCategories: intersection,
        quizCategory: waiting.quizCategory
      });
    }
    waiting.players[player.id] = player;
    waiting.order.push(player.id);
    startMatch(waiting);
    return viewMatch(waiting, player.id);
  }

  const match = {
    id: createId("match"),
    mode,
    difficulty,
    quizCategories,
    quizCategory: mode === "quiz" ? pickQuizCategory(quizCategories) : null,
    status: "waiting",
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    durationSec: DIFFICULTIES[difficulty].durationSec,
    questions: createQuestions({ mode, difficulty, quizCategories }),
    order: [player.id],
    players: {
      [player.id]: player
    },
    botId: null,
    result: null,
    statsRecorded: false,
    payment: {
      mode: "demo",
      token
    }
  };

  state.matches[match.id] = match;
  return viewMatch(match, player.id);
}

function reservePaidMatch(body) {
  const difficulty = DIFFICULTIES[body.difficulty] ? body.difficulty : "medium";
  const mode = normalizeMode(body.mode);
  const quizCategories = normalizeQuizCategories(body.quizCategories, mode);
  const token = normalizeToken(body.token);
  const wallet = sanitizeWallet(body.wallet);
  const identity = resolveIdentity({ ...body, wallet });
  const profile = identity ? ensurePlayerProfile(identity) : null;

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    throwHttp(400, "A connected wallet address is required for paid escrow matches");
  }

  cleanupWaitingMatches();

  const waiting = Object.values(state.matches).find(
    (match) =>
      match.status === "waiting" &&
      match.payment?.mode === "escrow" &&
      match.difficulty === difficulty &&
      (match.mode || "math") === mode &&
      match.payment.token === token &&
      (mode !== "quiz" || quizCategoryIntersection(match.quizCategories, quizCategories).length > 0) &&
      paidHumanPlayers(match).length === 1 &&
      match.order.length === 1 &&
      !Object.values(match.players).some(
        (existing) => existing.walletKey === walletKey(wallet) || playerMatchesIdentity(existing, identity)
      )
  );

  const player = createPlayer({
    wallet,
    identity,
    profile,
    demo: false,
    token,
    paid: false,
    name: shortWallet(wallet)
  });

  if (waiting) {
    if (mode === "quiz") {
      const intersection = quizCategoryIntersection(waiting.quizCategories, quizCategories);
      waiting.quizCategories = intersection;
      waiting.quizCategory = pickQuizCategory(intersection);
      waiting.questions = createQuestions({
        mode,
        difficulty,
        quizCategories: intersection,
        quizCategory: waiting.quizCategory
      });
    }
    waiting.players[player.id] = player;
    waiting.order.push(player.id);
    waiting.status = "funding";
    waiting.updatedAt = Date.now();
    return viewMatch(waiting, player.id);
  }

  const match = {
    id: createId("match"),
    mode,
    difficulty,
    quizCategories,
    quizCategory: mode === "quiz" ? pickQuizCategory(quizCategories) : null,
    status: "funding",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    durationSec: DIFFICULTIES[difficulty].durationSec,
    questions: createQuestions({ mode, difficulty, quizCategories }),
    order: [player.id],
    players: {
      [player.id]: player
    },
    botId: null,
    result: null,
    statsRecorded: false,
    payment: createEscrowPayment(token)
  };

  state.matches[match.id] = match;
  return viewMatch(match, player.id);
}

function confirmPaidMatch(body) {
  const matchId = String(body.matchId || "");
  const playerId = String(body.playerId || "");
  const match = getMatchOrThrow(matchId);
  const player = match.players[playerId];
  const identity = body.identity || resolveIdentity(body);
  const profile = body.profile || (identity ? ensurePlayerProfile(identity) : null);

  if (!player) {
    throwHttp(404, "Player not found");
  }

  if (match.payment?.mode !== "escrow") {
    throwHttp(400, "Match is not an escrow match");
  }

  if (match.payment.escrowId !== body.escrowId) {
    throwHttp(400, "Escrow id mismatch");
  }

  if (player.walletKey !== walletKey(body.wallet)) {
    throwHttp(400, "Wallet mismatch");
  }

  if (!body.txHash) {
    throwHttp(400, "A deposit transaction hash is required");
  }

  player.paid = true;
  player.txHash = body.txHash;
  player.profileId = player.profileId || profile?.id || identity?.key || player.profileId;
  player.identityKey = player.identityKey || identity?.key || player.identityKey;
  player.fid = player.fid || identity?.fid || null;
  player.devPlayerId = player.devPlayerId || identity?.devPlayerId || "";
  match.payment.txHashes[player.id] = body.txHash;
  match.updatedAt = Date.now();
  awardMatchEntryXp(player);

  if (paidHumanPlayers(match).length >= 2) {
    markMatched(match);
  } else {
    match.status = "waiting";
  }

  return viewMatch(match, player.id);
}

function tickMatch(match, forceFinish = false) {
  let changed = false;

  if (
    match.status === "waiting" &&
    match.payment?.mode === "escrow" &&
    Date.now() - Number(match.createdAt || 0) > MATCHMAKING_TIMEOUT_MS
  ) {
    match.lifecycleStatus = "refund_available";
    match.updatedAt = Date.now();
    changed = true;
  }

  if (
    match.status === "waiting" &&
    match.payment?.mode === "demo" &&
    Date.now() - match.createdAt > 4800
  ) {
    attachBot(match);
    startMatch(match);
    changed = true;
  }

  if (match.status === "active") {
    changed = advanceBot(match) || changed;

    Object.values(match.players).forEach((player) => {
      if (
        !player.finishedAt &&
        player.runStartedAt &&
        Date.now() - player.runStartedAt >= match.durationSec * 1000
      ) {
        player.finishedAt = Number(player.runStartedAt) + match.durationSec * 1000;
        changed = true;
      }
    });

    const deadlineExpired = Date.now() >= Number(match.deadlineAt || match.startedAt + MATCHMAKING_TIMEOUT_MS);
    const everyoneFinished = Object.values(match.players).every((player) => player.finishedAt);

    if (forceFinish || deadlineExpired || everyoneFinished) {
      finishMatch(match, deadlineExpired ? "deadline" : "complete");
      changed = true;
    }
  }

  if (match.status === "matched") {
    const deadlineExpired = Date.now() >= Number(match.deadlineAt || match.matchedAt + MATCHMAKING_TIMEOUT_MS);
    if (deadlineExpired || forceFinish) {
      finishMatch(match, "deadline");
      changed = true;
    }
  }

  return changed;
}

function markMatched(match) {
  if (!match.matchedAt) {
    match.matchedAt = Date.now();
  }
  match.status = "matched";
  match.deadlineAt = match.matchedAt + MATCHMAKING_TIMEOUT_MS;
  match.updatedAt = Date.now();
  syncMatchRecord(match);
}

function startMatch(match) {
  match.status = "active";
  match.startedAt = Date.now();
  match.deadlineAt = match.startedAt + MATCHMAKING_TIMEOUT_MS;
  Object.values(match.players).forEach((player) => {
    if (!player.finishedAt) {
      player.ready = true;
      player.runStartedAt = player.runStartedAt || match.startedAt;
      player.currentQuestionStartedAt = player.currentQuestionStartedAt || player.runStartedAt;
    }
  });
  match.updatedAt = Date.now();
  syncMatchRecord(match);
}

function attachBot(match) {
  if (match.botId) return;
  const botId = createId("bot");
  const names = ["Ada", "Rho", "BaseBot", "Euler", "Nova"];
  const player = createPlayer({
    id: botId,
    wallet: `bot:${botId}`,
    name: names[crypto.randomInt(names.length)],
    demo: true,
    isBot: true,
    paid: true,
    token: "USDC",
    txHash: ""
  });
  match.players[botId] = player;
  match.order.push(botId);
  match.botId = botId;
}

function submitAnswer(match, body) {
  tickMatch(match);

  if (match.status !== "active") {
    return viewMatch(match, body.playerId);
  }

  const player = match.players[body.playerId];
  if (!player) {
    throwHttp(404, "Player not found");
  }
  const identity = resolveIdentity(body);
  if (!identity || !playerMatchesIdentity(player, identity)) {
    throwHttp(403, "Player identity does not match this match seat");
  }

  const accepted = applyAnswer(match, player, body.answer);
  tickMatch(match);

  return {
    accepted,
    match: viewMatch(match, body.playerId)
  };
}

function startPlayerRun(match, player) {
  if (!["matched", "active"].includes(match.status) || player.finishedAt) return;
  if (match.status === "matched") {
    match.status = "active";
  }
  if (!match.startedAt) {
    match.startedAt = Date.now();
  }
  if (!match.deadlineAt) {
    match.deadlineAt = match.startedAt + MATCHMAKING_TIMEOUT_MS;
  }
  player.ready = true;
  if (!player.runStartedAt) {
    player.runStartedAt = Date.now();
  }
  if (!player.currentQuestionStartedAt) {
    player.currentQuestionStartedAt = player.runStartedAt;
  }
}

function applyAnswer(match, player, rawAnswer, botMs = null) {
  if (match.status !== "active" || player.finishedAt || !player.ready || !player.runStartedAt) {
    return false;
  }

  const index = player.answered;
  if (!Number.isInteger(index) || index < 0) {
    return false;
  }

  if (player.answers[String(index)]) {
    return false;
  }

  const question = ensureQuestion(match, index);
  const correct = isCorrectAnswer(rawAnswer, question.answer, match.mode);
  const config = DIFFICULTIES[match.difficulty];
  const now = Date.now();
  const startedAt = Number(player.currentQuestionStartedAt || match.startedAt || now);
  const ms = botMs === null ? clamp(now - startedAt, 0, match.durationSec * 1000) : botMs;

  player.answers[String(index)] = {
    answer: sanitizeSubmittedAnswer(rawAnswer),
    correct,
    ms,
    at: now
  };
  player.answered += 1;
  player.totalMs += ms;
  player.lastAnswerAt = now;
  player.currentQuestionStartedAt = now;

  const scoreDelta = calculateQuestionScore(config, ms, player.streak + 1);

  if (correct) {
    player.correct += 1;
    player.streak += 1;
    player.bestStreak = Math.max(player.bestStreak, player.streak);
    player.score += scoreDelta;
  } else {
    player.wrong += 1;
    player.streak = 0;
    player.score -= scoreDelta;
  }

  return true;
}

function advanceBot(match) {
  if (!match.botId || match.status !== "active") return false;
  const bot = match.players[match.botId];
  if (!bot || bot.finishedAt) return false;

  startPlayerRun(match, bot);
  const config = DIFFICULTIES[match.difficulty];
  const elapsed = Date.now() - bot.runStartedAt;
  const targetAnswered = Math.floor(elapsed / config.botPaceMs);

  let changed = false;
  for (let index = bot.answered; index < targetAnswered; index += 1) {
    const question = ensureQuestion(match, index);
    const correct = Math.random() < config.botAccuracy;
    const wobble = crypto.randomInt(1, 5) * (Math.random() > 0.5 ? 1 : -1);
    const answer = correct ? question.answer : question.answer + wobble;
    const ms = config.botPaceMs + crypto.randomInt(-450, 650);
    applyAnswer(match, bot, answer, ms);
    changed = true;
  }

  return changed;
}

function finishMatch(match, reason) {
  if (match.status === "finished") return;

  match.status = "finished";
  match.finishedAt = Date.now();

  const players = Object.values(match.players);
  players.forEach((player) => {
    if (!player.finishedAt) player.finishedAt = match.finishedAt;
  });

  const sorted = [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.correct !== a.correct) return b.correct - a.correct;
    return a.totalMs - b.totalMs;
  });

  const top = sorted[0];
  const second = sorted[1];
  const isDraw =
    second && top.score === second.score && top.correct === second.correct && top.totalMs === second.totalMs;

  match.result = {
    reason,
    winnerId: isDraw ? null : top.id,
    draw: isDraw,
    finishedAt: match.finishedAt
  };

  preparePayout(match);
  recordStats(match);
  void settleEscrow(match);
}

function recordStats(match) {
  if (match.statsRecorded) return;
  match.statsRecorded = true;

  Object.values(match.players).forEach((player) => {
    if (player.isBot || player.demo) return;

    const key = player.walletKey;
    const stats = state.stats[key] || createEmptyStats(player.wallet);
    const won = match.result && match.result.winnerId === player.id;
    const draw = Boolean(match.result && match.result.draw);

    stats.matches += 1;
    stats.wins += won ? 1 : 0;
    stats.losses += !won && !draw ? 1 : 0;
    stats.draws += draw ? 1 : 0;
    stats.score += player.score;
    stats.bestScore = Math.max(stats.bestScore, player.score);
    stats.bestStreak = Math.max(stats.bestStreak, player.bestStreak);
    stats.correct += player.correct;
    stats.answered += player.answered;
    stats.lastPlayedAt = new Date().toISOString();
    stats.display = shortWallet(player.wallet);
    stats.tokens[player.token] = (stats.tokens[player.token] || 0) + 1;

    state.stats[key] = stats;
    awardFinishedMatchXp(match, player, won);
  });
}

function viewMatch(match, playerId) {
  tickMatch(match);
  const viewer = match.players[playerId] || null;
  syncMatchRecord(match);
  return {
    matchId: match.id,
    playerId,
    mode: match.mode || "math",
    difficulty: match.difficulty,
    quizCategory: match.quizCategory || null,
    quizCategories: match.quizCategories || [],
    status: match.status,
    persistentStatus: match.lifecycleStatus,
    createdAt: match.createdAt,
    startedAt: match.startedAt,
    finishedAt: match.finishedAt,
    deadlineAt: match.deadlineAt || null,
    durationSec: match.durationSec,
    questionCount: null,
    serverNow: Date.now(),
    currentQuestion: getCurrentQuestionForPlayer(match, viewer),
    players: match.order.map((id) => publicPlayer(match.players[id])),
    payment: publicPayment(match),
    result: match.result,
    refundTxHash: match.refundTxHash || null
  };
}

function getCurrentQuestionForPlayer(match, player) {
  if (!player || match.status !== "active" || player.finishedAt || !player.ready || !player.runStartedAt) {
    return null;
  }
  const index = player.answered;
  const question = ensureQuestion(match, index);
  return {
    index,
    expression: question.expression,
    startedAt: player.currentQuestionStartedAt || match.startedAt
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    wallet: player.isBot ? "bot" : player.wallet,
    isBot: player.isBot,
    demo: player.demo,
    paid: player.paid,
    ready: Boolean(player.ready),
    score: player.score,
    answered: player.answered,
    correct: player.correct,
    wrong: player.wrong,
    streak: player.streak,
    bestStreak: player.bestStreak,
    runStartedAt: player.runStartedAt || null,
    finishedAt: player.finishedAt
  };
}

function publicPayment(match) {
  if (!match.payment) return null;

  if (match.payment.mode === "demo") {
    return {
      mode: "demo",
      token: match.payment.token
    };
  }

  return {
    mode: "escrow",
    token: match.payment.token,
    escrowId: match.payment.escrowId,
    entryFee: match.payment.entryFee,
    entryUnits: match.payment.entryUnits,
    potUnits: match.payment.potUnits,
    developerFeeBps: match.payment.developerFeeBps,
    developerFeeUnits: match.payment.developerFeeUnits,
    winnerPayoutUnits: match.payment.winnerPayoutUnits,
    cancelAvailableAt:
      match.status === "waiting" && paidHumanPlayers(match).length === 1
        ? Number(match.createdAt || Date.now()) + MATCHMAKING_TIMEOUT_MS
        : null,
    payout: match.payment.payout || null,
    settlement: match.payment.settlement || null
  };
}

function createPlayer(options) {
  const wallet = options.wallet || `guest:${createId("guest")}`;
  const identity = options.identity || null;
  const profile = options.profile || null;
  return {
    id: options.id || createId("player"),
    wallet,
    walletKey: walletKey(wallet),
    profileId: profile?.id || identity?.key || "",
    identityKey: identity?.key || "",
    fid: identity?.fid || null,
    devPlayerId: identity?.devPlayerId || "",
    name: sanitizeName(options.name || shortWallet(wallet)),
    isBot: Boolean(options.isBot),
    demo: Boolean(options.demo),
    paid: Boolean(options.paid),
    ready: Boolean(options.ready),
    token: options.token || "USDC",
    txHash: options.txHash || "",
    score: 0,
    answered: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    bestStreak: 0,
    totalMs: 0,
    answers: {},
    runStartedAt: null,
    currentQuestionStartedAt: null,
    finishedAt: null,
    lastAnswerAt: null
  };
}

function normalizeMode(mode) {
  const key = String(mode || "math").toLowerCase();
  return GAME_MODES[key] ? key : "math";
}

function publicQuizCategories() {
  return Object.entries(QUIZ_CATEGORIES).map(([id, category]) => ({
    id,
    label: category.label,
    questionCount: category.questions.length
  }));
}

function normalizeQuizCategories(value, mode = "quiz") {
  if (mode !== "quiz") return [];

  const raw = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const allowed = new Set(Object.keys(QUIZ_CATEGORIES));
  const selected = [...new Set(raw.map((item) => String(item).toLowerCase()))].filter((item) =>
    allowed.has(item)
  );

  return selected.length ? selected : [...allowed];
}

function quizCategoryIntersection(left, right) {
  const leftCategories = normalizeQuizCategories(left, "quiz");
  const rightCategories = normalizeQuizCategories(right, "quiz");
  const rightSet = new Set(rightCategories);
  return leftCategories.filter((category) => rightSet.has(category));
}

function pickQuizCategory(categories) {
  const normalized = normalizeQuizCategories(categories, "quiz");
  return normalized[crypto.randomInt(normalized.length)];
}

function ensureQuestion(match, index) {
  if (!Array.isArray(match.questions)) {
    match.questions = [];
  }

  while (match.questions.length <= index) {
    match.questions.push(createQuestion(match, match.questions.length));
  }

  return match.questions[index];
}

function createQuestion(match, index = 0) {
  const difficulty = DIFFICULTIES[match.difficulty] ? match.difficulty : "medium";
  const mode = normalizeMode(match.mode);

  if (mode === "quiz") {
    return createQuizQuestion({
      difficulty,
      quizCategories: match.quizCategories,
      quizCategory: match.quizCategory,
      index
    });
  }

  return createMathQuestion(difficulty);
}

function createQuestions(input) {
  const options =
    typeof input === "object" && input !== null ? input : { difficulty: input, mode: "math" };
  const difficulty = DIFFICULTIES[options.difficulty] ? options.difficulty : "medium";
  const mode = normalizeMode(options.mode);

  if (mode === "quiz") {
    return createQuizQuestions({
      difficulty,
      quizCategories: options.quizCategories,
      quizCategory: options.quizCategory
    });
  }

  return createMathQuestions(difficulty);
}

function createMathQuestions(difficulty) {
  const config = DIFFICULTIES[difficulty];
  const questions = [];

  for (let index = 0; index < config.questionCount; index += 1) {
    questions.push(createMathQuestion(difficulty));
  }

  return questions;
}

function createMathQuestion(difficulty) {
  const config = DIFFICULTIES[difficulty];
  const op = config.ops[crypto.randomInt(config.ops.length)];
  let a = randomInt(config.min, config.max);
  let b = randomInt(config.min, config.max);
  let answer;

  if (op === "+") {
    answer = a + b;
  } else if (op === "-") {
    if (b > a) [a, b] = [b, a];
    answer = a - b;
  } else if (op === "*") {
    a = randomInt(config.min, Math.max(config.min + 3, Math.floor(config.max / 4)));
    b = randomInt(config.min, Math.max(config.min + 3, Math.floor(config.max / 5)));
    answer = a * b;
  } else {
    b = randomInt(2, 12);
    answer = randomInt(2, Math.max(8, Math.floor(config.max / b)));
    a = answer * b;
  }

  return {
    expression: `${a} ${op} ${b}`,
    answer
  };
}

function createQuizQuestions(options) {
  const config = DIFFICULTIES[options.difficulty];
  const questions = [];

  for (let index = 0; index < config.questionCount; index += 1) {
    questions.push(createQuizQuestion({ ...options, index }));
  }

  return questions;
}

function createQuizQuestion(options) {
  const quizCategory =
    QUIZ_CATEGORIES[options.quizCategory] ? options.quizCategory : pickQuizCategory(options.quizCategories);
  const pool = QUIZ_CATEGORIES[quizCategory].questions;
  const item = pool[crypto.randomInt(pool.length)];
  return {
    expression: item.expression,
    answer: item.answer,
    category: quizCategory
  };
}

function isCorrectAnswer(submitted, expected, mode = "math") {
  if (Array.isArray(expected)) {
    return expected.some((answer) => isCorrectAnswer(submitted, answer, mode));
  }

  if (mode !== "quiz" && typeof expected === "number") {
    const value = Number(submitted);
    return Number.isFinite(value) && Math.abs(value - expected) < 0.000001;
  }

  return normalizeAnswerText(submitted) === normalizeAnswerText(expected);
}

function normalizeAnswerText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sanitizeSubmittedAnswer(value) {
  return sanitizeText(String(value ?? ""), 160);
}

function calculateQuestionScore(config, ms, streak = 1) {
  const durationMs = Math.max(1000, Number(config.durationSec || 45) * 1000);
  const speedRatio = clamp(1 - ms / durationMs, 0, 1);
  const speedBonus = Math.round(speedRatio * 40);
  const streakBonus = Math.min(60, Math.max(0, Number(streak || 1) - 1) * 5);
  return Math.max(10, 50 + speedBonus + streakBonus);
}

function cleanupWaitingMatches() {
  const now = Date.now();
  Object.values(state.matches).forEach((match) => {
    if (match.status === "waiting" && match.payment?.mode === "demo" && now - match.createdAt > 60000) {
      attachBot(match);
      startMatch(match);
      finishMatch(match, "expired");
    }

    if (match.payment?.mode === "escrow" && match.status === "funding" && now - match.updatedAt > 10 * 60 * 1000) {
      const paidPlayers = paidHumanPlayers(match);
      if (paidPlayers.length === 0) {
        delete state.matches[match.id];
        return;
      }

      if (paidPlayers.length === 1) {
        match.order = match.order.filter((id) => match.players[id].paid);
        Object.keys(match.players).forEach((id) => {
          if (!match.players[id].paid) delete match.players[id];
        });
        match.status = "waiting";
        match.updatedAt = now;
      }
    }
  });
}

function createEscrowPayment(token) {
  const entryUnits = getEntryUnits(token);
  const potUnits = entryUnits * 2n;
  const developerFeeUnits = (potUnits * DEVELOPER_FEE_BPS) / BPS_DENOMINATOR;
  const winnerPayoutUnits = potUnits - developerFeeUnits;

  return {
    mode: "escrow",
    token,
    escrowId: createEscrowId(),
    entryFee: formatTokenUnits(entryUnits, getTokenDecimals(token)),
    entryUnits: entryUnits.toString(),
    potUnits: potUnits.toString(),
    developerFeeBps: Number(DEVELOPER_FEE_BPS),
    developerFeeUnits: developerFeeUnits.toString(),
    winnerPayoutUnits: winnerPayoutUnits.toString(),
    txHashes: {},
    settlement: {
      status: "not_started",
      txHash: null,
      error: null
    }
  };
}

function paidHumanPlayers(match) {
  return Object.values(match.players).filter((player) => !player.isBot && !player.demo && player.paid);
}

function preparePayout(match) {
  if (match.payment?.mode !== "escrow" || match.payment.payout) return;

  const winner = match.result?.winnerId ? match.players[match.result.winnerId] : null;
  const token = match.payment.token;
  const decimals = getTokenDecimals(token);
  match.payment.payout = {
    token,
    escrowId: match.payment.escrowId,
    entryFee: match.payment.entryFee || formatTokenUnits(BigInt(match.payment.entryUnits), decimals),
    pot: formatTokenUnits(BigInt(match.payment.potUnits), decimals),
    developerFee: match.result.draw ? "0" : formatTokenUnits(BigInt(match.payment.developerFeeUnits), decimals),
    winnerPayout: match.result.draw ? "0" : formatTokenUnits(BigInt(match.payment.winnerPayoutUnits), decimals),
    winnerWallet: winner && !winner.isBot ? winner.wallet : null,
    draw: Boolean(match.result.draw)
  };
}

async function settleEscrow(match) {
  if (match.payment?.mode !== "escrow" || !match.payment.payout) return;

  if (!ESCROW_CONTRACT_ADDRESS || !ESCROW_RESOLVER_PRIVATE_KEY) {
    match.payment.settlement = {
      status: "resolver_not_configured",
      txHash: null,
      error: "Set ESCROW_CONTRACT_ADDRESS and ESCROW_RESOLVER_PRIVATE_KEY to auto-settle payouts"
    };
    saveState();
    return;
  }

  if (match.payment.settlement?.status === "submitted") return;

  const winner = match.payment.payout.winnerWallet || "0x0000000000000000000000000000000000000000";

  try {
    match.payment.settlement = { status: "submitting", txHash: null, error: null };
    saveState();

    const { ethers } = await import("ethers");
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL, BASE_CHAIN_ID);
    const wallet = new ethers.Wallet(ESCROW_RESOLVER_PRIVATE_KEY, provider);
    const escrow = new ethers.Contract(
      ESCROW_CONTRACT_ADDRESS,
      ["function resolve(bytes32 matchId,address winner,bool draw) external"],
      wallet
    );
    const tx = await escrow.resolve(match.payment.escrowId, winner, Boolean(match.result.draw));

    match.payment.settlement = {
      status: "submitted",
      txHash: tx.hash,
      error: null
    };
    saveState();
  } catch (error) {
    match.payment.settlement = {
      status: "failed",
      txHash: null,
      error: sanitizeSecretText(error.message || "Settlement failed")
    };
    saveState();
  }
}

function buildLeaderboard(options = {}) {
  const sort = options.sort === "worst" ? "worst" : "top";
  const search = String(options.search || "").trim().toLowerCase();
  const ranked = Object.values(state.stats).sort((a, b) => {
    if (sort === "worst") {
      if (a.wins !== b.wins) return a.wins - b.wins;
      if (a.score !== b.score) return a.score - b.score;
      return a.bestScore - b.bestScore;
    }
    if (b.score !== a.score) return b.score - a.score;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.bestScore - a.bestScore;
  });

  const rows = ranked.map((stats, index) => ({
      rank: index + 1,
      display: stats.display,
      wallet: stats.wallet,
      score: stats.score,
      wins: stats.wins,
      losses: stats.losses,
      matches: stats.matches,
      accuracy: stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0,
      bestScore: stats.bestScore
  }));

  if (search) {
    const found = rows.filter(
      (row) =>
        row.display.toLowerCase().includes(search) ||
        String(row.wallet || "").toLowerCase().includes(search)
    );
    return found.slice(0, 100);
  }

  return rows.slice(0, 100);
}

function createEmptyStats(wallet) {
  return {
    wallet,
    display: shortWallet(wallet),
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    score: 0,
    bestScore: 0,
    bestStreak: 0,
    correct: 0,
    answered: 0,
    tokens: {
      ETH: 0,
      USDC: 0,
      USDT: 0
    },
    lastPlayedAt: null
  };
}

function loadState() {
  return normalizeState(storage.loadState());
}

function saveState() {
  storage.saveState(state);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throwHttp(400, "Invalid JSON");
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function canUseSettlementAdmin(req) {
  const expectedToken = process.env.SETTLEMENT_ADMIN_TOKEN || "";
  if (expectedToken) {
    return req.headers["x-admin-token"] === expectedToken;
  }

  const remoteAddress = req.socket?.remoteAddress || "";
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress);
}

function getMatchOrThrow(id) {
  const match = state.matches[id];
  if (!match) {
    throwHttp(404, "Match not found");
  }
  return match;
}

function throwHttp(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function sanitizeWallet(wallet) {
  const value = String(wallet || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) return value;
  if (/^guest:[a-zA-Z0-9_-]{4,48}$/.test(value)) return value;
  return `guest:${createId("local")}`;
}

function sanitizeWalletAddress(wallet) {
  const value = String(wallet || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value : "";
}

function sanitizeFid(fid) {
  const value = Number(fid);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function sanitizeDevPlayerId(value) {
  const text = String(value || "").trim();
  return /^(player1|player2|player3)$/.test(text) ? text : "";
}

function sanitizeTxHash(txHash) {
  const value = String(txHash || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(value) ? value : "";
}

function sanitizeUrl(value) {
  const text = String(value || "").trim().slice(0, 240);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function sanitizeText(value, max = 80) {
  return String(value || "")
    .replace(/[^\w .:/?#@-]/g, "")
    .trim()
    .slice(0, max);
}

function sanitizeChatMessage(value) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function sanitizeName(name) {
  return String(name || "")
    .replace(/[^\w .:-]/g, "")
    .trim()
    .slice(0, 18) || "Player";
}

function walletKey(wallet) {
  return String(wallet || "").toLowerCase();
}

function shortWallet(wallet) {
  const value = String(wallet || "");
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }
  return value.replace(/^guest:/, "Guest ").slice(0, 18) || "Guest";
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function createEscrowId() {
  return `0x${crypto.randomBytes(32).toString("hex")}`;
}

function normalizeToken(token) {
  const value = String(token || "ETH").toUpperCase();
  return TOKENS[value] ? value : "ETH";
}

function getEntryUnits(token) {
  return TOKENS[token]?.entryUnits || TOKENS.ETH.entryUnits;
}

function getTokenDecimals(token) {
  return TOKENS[token]?.decimals || TOKENS.ETH.decimals;
}

function formatTokenUnits(units, decimals = 6) {
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fraction = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function sanitizeSecretText(value) {
  return String(value)
    .replace(/0x[a-fA-F0-9]{64}/g, "[redacted-private-key-like-value]")
    .replace(/[A-Za-z0-9_]*PRIVATE_KEY[A-Za-z0-9_]*/g, "[redacted-private-key-name]");
}

function randomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
