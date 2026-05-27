require("dotenv").config();

const PORT = Number(process.env.PORT || 4173);
const PLACEHOLDER_URL = "https://your-domain.example";

function normalizeUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function getBaseUrl() {
  const configured = normalizeUrl(process.env.APP_URL);
  if (configured && configured !== PLACEHOLDER_URL) return configured;
  return `http://localhost:${PORT}`;
}

function isLocalUrl(value) {
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(value);
}

function decodeHtmlAttr(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function findMetaContent(html, name) {
  const pattern = new RegExp(
    `<meta\\s+[^>]*name=["']${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}["'][^>]*>`,
    "i"
  );
  const tag = html.match(pattern)?.[0] || "";
  return decodeHtmlAttr(tag.match(/\scontent=(["'])(.*?)\1/i)?.[2] || "");
}

function requireField(value, label, errors) {
  if (!value) errors.push(`${label} is missing`);
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.text();
}

async function main() {
  const baseUrl = getBaseUrl();
  const errors = [];
  const warnings = [];

  console.log(`Checking Mini App at ${baseUrl}`);

  if (!baseUrl.startsWith("https://") && !isLocalUrl(baseUrl)) {
    errors.push("APP_URL must be HTTPS for Farcaster production");
  }

  if (baseUrl === PLACEHOLDER_URL) {
    errors.push("APP_URL is still the placeholder domain");
  }

  const [html, manifestText] = await Promise.all([
    fetchText(`${baseUrl}/`),
    fetchText(`${baseUrl}/.well-known/farcaster.json`)
  ]);

  const manifest = JSON.parse(manifestText);
  const miniapp = manifest.miniapp || manifest.frame || {};

  requireField(miniapp.version, "manifest.miniapp.version", errors);
  requireField(miniapp.name, "manifest.miniapp.name", errors);
  requireField(miniapp.homeUrl, "manifest.miniapp.homeUrl", errors);
  requireField(miniapp.iconUrl, "manifest.miniapp.iconUrl", errors);

  if (miniapp.version && miniapp.version !== "1") {
    errors.push("manifest.miniapp.version must be \"1\"");
  }

  if (!manifest.accountAssociation) {
    warnings.push("manifest.accountAssociation is missing; generate it after deploying to your HTTPS domain");
  } else {
    requireField(manifest.accountAssociation.header, "accountAssociation.header", errors);
    requireField(manifest.accountAssociation.payload, "accountAssociation.payload", errors);
    requireField(manifest.accountAssociation.signature, "accountAssociation.signature", errors);
  }

  const miniappMeta = findMetaContent(html, "fc:miniapp");
  const frameMeta = findMetaContent(html, "fc:frame");
  requireField(miniappMeta, "fc:miniapp meta tag", errors);

  if (miniappMeta) {
    const embed = JSON.parse(miniappMeta);
    const action = embed.button?.action || {};
    if (action.type !== "launch_miniapp") {
      errors.push("fc:miniapp button.action.type must be launch_miniapp");
    }
    requireField(action.url, "fc:miniapp button.action.url", errors);
    requireField(action.splashImageUrl, "fc:miniapp splashImageUrl", errors);
  }

  if (!frameMeta) {
    warnings.push("fc:frame fallback meta tag is missing");
  }

  warnings.forEach((warning) => console.log(`WARN ${warning}`));

  if (errors.length) {
    errors.forEach((error) => console.error(`FAIL ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log("OK manifest endpoint");
  console.log("OK fc:miniapp embed");
  console.log("Mini App check passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
