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
      game: "on-chain-poker-table",
      runtime: "cloudflare-pages"
    });
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

function chatKey(room) {
  return `chat:${room}`;
}

function normalizeRoom(room) {
  return room === "table" ? "table" : "lobby";
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
