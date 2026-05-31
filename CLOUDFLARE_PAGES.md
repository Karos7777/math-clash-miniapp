# Cloudflare Pages Deploy

This app can run on Cloudflare Pages without Render.

## Pages settings

Use these Cloudflare Pages build settings:

```text
Framework preset: None
Build command: npm install
Build output directory: public
Root directory: /
```

The `functions/_middleware.js` file handles:

- `/`
- `/config.js`
- `/.well-known/farcaster.json`
- `/api/health`
- `/api/chat`

## Environment variables

Set these in Cloudflare Pages production variables:

```env
APP_NAME=Poker Clash
APP_URL=https://poker.karos.dpdns.org
GAME_CONTRACT_ADDRESS=0xYOUR_BASE_SEPOLIA_TABLE
BASE_CHAIN_ID=84532
BASE_RPC_URL=https://sepolia.base.org
FARCASTER_NOINDEX=true
DEFAULT_STAKE_ETH=0.0001
DEFAULT_BET_ETH=0.00001
```

Do not put private keys in Cloudflare Pages.

## Domain

In Cloudflare Pages, add this custom domain:

```text
poker.karos.dpdns.org
```

If the domain is already managed by Cloudflare DNS, Pages can usually create the DNS record for you.
Otherwise add:

```text
Type: CNAME
Name: poker
Target: your-pages-project.pages.dev
```

## Persistent chat

For persistent lobby/table chat on Cloudflare Pages, create a KV namespace and bind it to the Pages project:

```text
Binding name: CHAT_KV
```

Without `CHAT_KV`, the app still loads, but chat writes return an error because Pages has no local filesystem storage.

## Check after deploy

```powershell
$env:APP_URL="https://poker.karos.dpdns.org"
npm run check:miniapp
```

Open:

```text
https://poker.karos.dpdns.org/
https://poker.karos.dpdns.org/.well-known/farcaster.json
https://poker.karos.dpdns.org/config.js
```
