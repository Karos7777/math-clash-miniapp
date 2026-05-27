const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

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
const STATE_FILE = path.join(DATA_DIR, "state.json");

const APP_NAME = process.env.APP_NAME || "Math Clash";
const APP_URL = normalizeAppUrl(process.env.APP_URL || "https://your-domain.example");
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

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

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
  console.log(`Math Clash running at http://${displayHost}:${PORT}`);
});

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      baseChainId: BASE_CHAIN_ID,
      entryFee: ENTRY_FEE,
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

  if (req.method === "GET" && url.pathname === "/api/leaderboard") {
    sendJson(res, 200, {
      leaderboard: buildLeaderboard(),
      updatedAt: new Date().toISOString()
    });
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

    player.finishedAt = Date.now();
    tickMatch(match, true);
    saveState();
    sendJson(res, 200, viewMatch(match, body.playerId));
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

  const matchView = url.pathname.match(/^\/api\/matches\/([^/]+)$/);
  if (req.method === "GET" && matchView) {
    const match = getMatchOrThrow(matchView[1]);
    const playerId = url.searchParams.get("playerId");
    tickMatch(match);
    saveState();
    sendJson(res, 200, viewMatch(match, playerId));
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
    subtitle: "1v1 math battles",
    description: "Solve faster than your rival and settle escrow payouts on Base.",
    tagline: "Solve fast. Win escrow.",
    primaryCategory: "games",
    tags: ["math", "game", "base", "pvp"],
    ogTitle: APP_NAME,
    ogDescription: "Fast 1v1 math battles with Base escrow payouts.",
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

function joinMatch(body) {
  const difficulty = DIFFICULTIES[body.difficulty] ? body.difficulty : "medium";
  const token = normalizeToken(body.token);
  const wallet = sanitizeWallet(body.wallet);
  const txHash = sanitizeTxHash(body.txHash);
  const demo = Boolean(body.demo);

  if (!demo) {
    return confirmPaidMatch({ ...body, difficulty, token, wallet, txHash });
  }

  cleanupWaitingMatches();

  const player = createPlayer({
    wallet,
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
      match.payment?.mode === "demo" &&
      !match.players[player.id] &&
      !Object.values(match.players).some((existing) => existing.walletKey === player.walletKey)
  );

  if (waiting) {
    waiting.players[player.id] = player;
    waiting.order.push(player.id);
    startMatch(waiting);
    return viewMatch(waiting, player.id);
  }

  const match = {
    id: createId("match"),
    difficulty,
    status: "waiting",
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    durationSec: DIFFICULTIES[difficulty].durationSec,
    questions: createQuestions(difficulty),
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
  const token = normalizeToken(body.token);
  const wallet = sanitizeWallet(body.wallet);

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    throwHttp(400, "A connected wallet address is required for paid escrow matches");
  }

  cleanupWaitingMatches();

  const waiting = Object.values(state.matches).find(
    (match) =>
      match.status === "waiting" &&
      match.payment?.mode === "escrow" &&
      match.difficulty === difficulty &&
      match.payment.token === token &&
      paidHumanPlayers(match).length === 1 &&
      match.order.length === 1 &&
      !Object.values(match.players).some((existing) => existing.walletKey === walletKey(wallet))
  );

  const player = createPlayer({
    wallet,
    demo: false,
    token,
    paid: false,
    name: shortWallet(wallet)
  });

  if (waiting) {
    waiting.players[player.id] = player;
    waiting.order.push(player.id);
    waiting.status = "funding";
    waiting.updatedAt = Date.now();
    return viewMatch(waiting, player.id);
  }

  const match = {
    id: createId("match"),
    difficulty,
    status: "funding",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    durationSec: DIFFICULTIES[difficulty].durationSec,
    questions: createQuestions(difficulty),
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
  match.payment.txHashes[player.id] = body.txHash;
  match.updatedAt = Date.now();

  if (paidHumanPlayers(match).length >= 2) {
    startMatch(match);
  } else {
    match.status = "waiting";
  }

  return viewMatch(match, player.id);
}

function tickMatch(match, forceFinish = false) {
  let changed = false;

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

    const elapsed = Date.now() - match.startedAt;
    const timeExpired = elapsed >= match.durationSec * 1000;
    const everyoneFinished = Object.values(match.players).every(
      (player) => player.finishedAt || player.answered >= match.questions.length
    );

    if (forceFinish || timeExpired || everyoneFinished) {
      finishMatch(match, timeExpired ? "time" : "complete");
      changed = true;
    }
  }

  return changed;
}

function startMatch(match) {
  match.status = "active";
  match.startedAt = Date.now();
  match.updatedAt = Date.now();
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

  const index = Number(body.index);
  const ms = clamp(Number(body.ms) || 0, 0, 30000);
  applyAnswer(match, player, index, body.answer, ms);

  return {
    accepted: true,
    match: viewMatch(match, body.playerId)
  };
}

function applyAnswer(match, player, index, rawAnswer, ms) {
  if (!Number.isInteger(index) || index < 0 || index >= match.questions.length) {
    return false;
  }

  if (player.answers[String(index)]) {
    return false;
  }

  const question = match.questions[index];
  const answer = Number(rawAnswer);
  const correct = Number.isFinite(answer) && answer === question.answer;
  const config = DIFFICULTIES[match.difficulty];

  player.answers[String(index)] = {
    answer: Number.isFinite(answer) ? answer : null,
    correct,
    ms,
    at: Date.now()
  };
  player.answered += 1;
  player.totalMs += ms;
  player.lastAnswerAt = Date.now();

  if (correct) {
    player.correct += 1;
    player.streak += 1;
    player.bestStreak = Math.max(player.bestStreak, player.streak);
    const targetMs = Math.max(1600, config.botPaceMs - 900);
    const speedBonus = Math.max(0, Math.round((targetMs - Math.min(ms, targetMs)) / 80));
    const streakBonus = Math.min(60, player.streak * 6);
    player.score += 100 + speedBonus + streakBonus;
  } else {
    player.wrong += 1;
    player.streak = 0;
    player.score = Math.max(0, player.score - 20);
  }

  if (player.answered >= match.questions.length) {
    player.finishedAt = Date.now();
  }

  return true;
}

function advanceBot(match) {
  if (!match.botId || match.status !== "active") return false;
  const bot = match.players[match.botId];
  if (!bot || bot.finishedAt) return false;

  const config = DIFFICULTIES[match.difficulty];
  const elapsed = Date.now() - match.startedAt;
  const targetAnswered = Math.min(
    match.questions.length,
    Math.floor(elapsed / config.botPaceMs)
  );

  let changed = false;
  for (let index = bot.answered; index < targetAnswered; index += 1) {
    const question = match.questions[index];
    const correct = Math.random() < config.botAccuracy;
    const wobble = crypto.randomInt(1, 5) * (Math.random() > 0.5 ? 1 : -1);
    const answer = correct ? question.answer : question.answer + wobble;
    const ms = config.botPaceMs + crypto.randomInt(-450, 650);
    applyAnswer(match, bot, index, answer, ms);
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
  });
}

function viewMatch(match, playerId) {
  tickMatch(match);
  return {
    matchId: match.id,
    playerId,
    difficulty: match.difficulty,
    status: match.status,
    createdAt: match.createdAt,
    startedAt: match.startedAt,
    finishedAt: match.finishedAt,
    durationSec: match.durationSec,
    questions: match.questions.map(({ expression }, index) => ({
      index,
      expression
    })),
    players: match.order.map((id) => publicPlayer(match.players[id])),
    payment: publicPayment(match),
    result: match.result
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
    score: player.score,
    answered: player.answered,
    correct: player.correct,
    wrong: player.wrong,
    streak: player.streak,
    bestStreak: player.bestStreak,
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
    payout: match.payment.payout || null,
    settlement: match.payment.settlement || null
  };
}

function createPlayer(options) {
  const wallet = options.wallet || `guest:${createId("guest")}`;
  return {
    id: options.id || createId("player"),
    wallet,
    walletKey: walletKey(wallet),
    name: sanitizeName(options.name || shortWallet(wallet)),
    isBot: Boolean(options.isBot),
    demo: Boolean(options.demo),
    paid: Boolean(options.paid),
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
    finishedAt: null,
    lastAnswerAt: null
  };
}

function createQuestions(difficulty) {
  const config = DIFFICULTIES[difficulty];
  const questions = [];

  for (let index = 0; index < config.questionCount; index += 1) {
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

    questions.push({
      expression: `${a} ${op} ${b}`,
      answer
    });
  }

  return questions;
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

function buildLeaderboard() {
  return Object.values(state.stats)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.bestScore - a.bestScore;
    })
    .slice(0, 25)
    .map((stats, index) => ({
      rank: index + 1,
      display: stats.display,
      wallet: stats.wallet,
      score: stats.score,
      wins: stats.wins,
      matches: stats.matches,
      accuracy: stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0,
      bestScore: stats.bestScore
    }));
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
      USDC: 0,
      USDT: 0
    },
    lastPlayedAt: null
  };
}

function loadState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    return { matches: {}, stats: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      matches: parsed.matches && typeof parsed.matches === "object" ? parsed.matches : {},
      stats: parsed.stats && typeof parsed.stats === "object" ? parsed.stats : {}
    };
  } catch (error) {
    console.warn("Could not read state file, starting fresh:", error.message);
    return { matches: {}, stats: {} };
  }
}

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, STATE_FILE);
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

function sanitizeTxHash(txHash) {
  const value = String(txHash || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(value) ? value : "";
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
