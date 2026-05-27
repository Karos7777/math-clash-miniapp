# Math Clash Farcaster Mini App

1v1 speed math battles for Farcaster Mini Apps with Base Sepolia escrow testing, local matchmaking, stats, and leaderboard.

## Contract summary

The escrow contract is `contracts/Escrow.sol`.

It can receive either native Base Sepolia ETH or supported ERC-20 test tokens from each player. When both players have funded the same match, the game can start. After the server decides the winner, only the resolver wallet can call `resolve`.

Default ETH test payout rules:

- Player A deposit: `0.0001 ETH`
- Player B deposit: `0.0001 ETH`
- Total pot: `0.0002 ETH`
- Winner receives: `0.000192 ETH`
- Developer fee recipient receives: `0.000008 ETH`
- Draw: each player gets `0.0001 ETH` back and no developer fee is taken

USDC payout rules:

- Player A deposit: `0.1`
- Player B deposit: `0.1`
- Total pot: `0.2`
- Winner receives: `0.192`
- Developer fee recipient receives: `0.008`
- Draw: each player gets `0.1` back and no developer fee is taken

Roles:

- `owner`: deployer at first. Can set resolver, fee recipient, supported tokens, pause/unpause, transfer ownership, and emergency-refund players while paused.
- `resolver`: backend payout wallet. Can only resolve finished matches. It cannot pause, change roles, or rescue tokens.
- `feeRecipient`: receives the 4% fee. It has no admin power.

Safety controls:

- `pause()` / `unpause()` emergency stop by owner.
- `deposit()` and `resolve()` are blocked while paused.
- `emergencyRefund()` can only run while paused and only refunds deposited players.
- There is no owner withdrawal for ETH, USDC, or USDT game funds.
- `rescueUnsupportedToken()` can only rescue tokens that were never supported as game tokens.
- `cancelUnmatched()` lets the first depositor refund an unmatched match after 30 minutes.

## Run locally

```bash
npm install
npm run assets
npm start
```

Open `http://localhost:4173`.

## Farcaster Mini App setup

The server now serves the Mini App manifest dynamically at:

```text
/.well-known/farcaster.json
```

Set the public URL before deploying:

```bash
APP_NAME=Math Clash
APP_URL=https://your-real-domain.example
```

The HTML also includes `fc:miniapp` and `fc:frame` embed tags, generated from `APP_URL`, so a cast can launch the app inside Farcaster.

For Base Sepolia testing, keep:

```bash
FARCASTER_NOINDEX=true
```

After the app is deployed on HTTPS, generate the Farcaster account association for that exact domain and fill:

```bash
FARCASTER_ACCOUNT_ASSOCIATION_HEADER=
FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD=
FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE=
```

Then restart the server and check:

```bash
npm run check:miniapp
```

The check warns if `accountAssociation` is missing. That is expected locally, but production publishing needs it.

## Persistent matchmaking, XP, and quests

The app restores active player state from the server on page load through:

```text
/api/me
/api/match/status
```

Identity priority is:

1. Farcaster `fid`
2. Connected wallet address
3. `devPlayerId` only when `DEV_MODE=true` or `NODE_ENV !== production`

If a player has already paid and is waiting for an opponent, refresh now restores the same searching match. If the second player has joined, refresh restores the active game. Finished matches show result and settlement status.

Paid matchmaking is asynchronous:

- Player 1 can pay, leave the Mini App, and come back later.
- Player 2 can join and start their run immediately.
- Player 1's personal match timer starts when they return to the active match.
- The match has a 48 hour deadline from the moment both players are funded.

Anti-cheat basics:

- The frontend sends only the player's raw answer.
- The server checks correctness.
- The server sends only the current question, not the whole question list.
- Correct answers are never sent to the frontend.
- Answer timing is calculated on the server.
- Winner selection is server-side only.

The chat endpoint is persistent across refresh:

```text
GET /api/chat
POST /api/chat
```

It keeps the latest messages so players can coordinate, for example to say they are looking for a medium mode match.

XP is off-chain only for now. The app intentionally says:

```text
XP may be used for future rewards if the project continues.
```

It does not promise a token or guaranteed airdrop.

Initial XP rules:

- Play first match: `+10 XP`
- Daily first match: `+10 XP`
- Finish match: `+10 XP`
- Win match: `+25 XP`
- Share result quest: manual/pending claim for `+20 XP`
- Invite friend quest: manual/pending claim for `+50 XP`

Social quests that require Farcaster verification are stored as pending manual claims unless a real Farcaster/Neynar verification API is added later.

## Storage

The storage abstraction lives in `storage/index.js`.

Default local/dev storage is JSON:

```text
data/state.json
```

You can override it for tests:

```bash
MATH_CLASH_STATE_FILE=/tmp/math-clash-state.json
```

For production, the app recognizes these database env vars so Supabase/Postgres can be wired in without changing the public frontend:

```bash
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

If no database env is present, it falls back to local JSON storage. On Render Free this is better than in-memory state, but a real database is still recommended before mainnet.

## Dev testing mode

Local/dev mode shows a small Dev Mode panel with:

- `player1`
- `player2`
- `player3`
- Reset button

Dev mode is enabled when:

```bash
DEV_MODE=true
```

or when `NODE_ENV` is not `production`. It is disabled in production and `devPlayerId` is ignored there.

Checks:

```bash
npm run check:storage
npm run check:matchmaking
```

## Base Sepolia settings

The project is configured for Base Sepolia by default:

- Chain ID: `84532`
- RPC: `https://sepolia.base.org`
- Explorer: `https://sepolia-explorer.base.org`
- USDC testnet token: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Native ETH entry: `0.0001 ETH`

ETH is the easiest test path because it does not require token swaps or ERC-20 approve. USDT does not have a default official Base Sepolia address in this project. Use a mock/test USDT address only if you deploy or verify one yourself.

## Hardhat deploy to Base Sepolia

1. Copy `.env.example` to `.env`.
2. Fill only local secrets in `.env`. Never put private keys in `public/config.js`.
3. Install dependencies:

```bash
npm install
```

4. Compile:

```bash
npm run compile
```

5. Deploy only to Base Sepolia:

```bash
npm run deploy:base-sepolia
```

The deploy script refuses to deploy unless the connected chain ID is `84532`.

After deployment it prints:

```text
Escrow deployed: 0x...
Copy this into public/config.js:
escrowAddress: "0x...",
```

Put that contract address into `public/config.js`.

## Remix deploy option

Use Remix only on Base Sepolia first:

1. Open `contracts/Escrow.sol` in Remix.
2. Compile with Solidity `0.8.24`.
3. In MetaMask/Coinbase Wallet, select Base Sepolia.
4. Constructor arguments:
   - `initialResolver`: backend resolver wallet address
   - `initialFeeRecipient`: developer fee wallet address
   - `initialTokens`: `["0x036CbD53842c5426634e7929541eC2318f3dCF7e"]`
5. Deploy.
6. Copy the deployed contract address into `public/config.js`.

Native ETH is supported automatically by the contract, so you do not put an ETH token address in `initialTokens`.

## Server environment variables

`server.js` needs these for automatic payout settlement:

```bash
BASE_CHAIN_ID=84532
BASE_RPC_URL=https://sepolia.base.org
ESCROW_CONTRACT_ADDRESS=0xYourSepoliaEscrowContract
ESCROW_RESOLVER_PRIVATE_KEY=0xResolverPrivateKey
PORT=4173
```

The resolver private key must belong to the same wallet address used as `initialResolver` in the contract constructor.

## Frontend config

`public/config.js` is public and should contain only public values:

```js
escrowAddress: "0xYourSepoliaEscrowContractAddress"
```

Never put private keys, seed phrases, RPC secrets, or backend-only env vars in `public/config.js`.

## Git and key safety

The `.gitignore` blocks:

- `.env`
- `.env.*`
- `node_modules/`
- Hardhat `artifacts/` and `cache/`
- `logs/*.log`
- `data/state.json`

Before pushing, run:

```bash
rg "PRIVATE_KEY|SECRET|0x[a-fA-F0-9]{64}" -n .
```

Review every match manually. A real private key is 64 hex characters, often prefixed by `0x`.

## Mainnet later

Do not deploy to Base mainnet until Sepolia deposits, refunds, resolver payouts, pause, and emergency refunds have been tested. For mainnet, switch the chain config, token addresses, RPC, and Farcaster manifest deliberately in a separate change.
