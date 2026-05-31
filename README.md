# Poker Clash Farcaster Mini App

Poker Clash is a Base Sepolia testnet MVP for a two-player poker table inside one Farcaster Mini App.

The app has two screens:

- `/` lobby: connect wallet and press Start Game.
- `/#/table/:tableId` table: player1/player2, pot, stake, stage, turn, 60 second timer, actions, cards, and table chat.

Money movement is handled by the Solidity contract. Lobby matching, table UI state, prototype cards, and chat are stored in Cloudflare KV on Pages, with local JSON storage for development.

Important: card dealing is off-chain in this prototype and not fully trustless yet. This is fine for Base Sepolia testing, but production poker needs a verifiable dealing design.

## Contract

The contract is [contracts/Escrow.sol](contracts/Escrow.sol). The name stays `Escrow` so older scripts still find it.

Main flow:

- `joinTable(bytes32 tableId)` payable: player sends the ETH stake for a table.
- `confirm(bytes32 tableId)`: after both players joined, each player confirms by transaction within 60 seconds.
- `check(bytes32 tableId)`: pass action if there is no open bet.
- `bet(bytes32 tableId)` payable: send an ETH bet into the pot.
- `call(bytes32 tableId)` payable: match the open bet.
- `fold(bytes32 tableId)`: fold and settle the pot to the opponent.
- `timeout(bytes32 tableId)`: after 60 seconds of inactivity, the inactive player loses. At showdown, one submitted result can be settled by timeout if the other player is inactive.
- `submitResult(bytes32 tableId,address winner)`: submit the off-chain showdown winner.
- `claimWinnings()`: withdraw settled winnings.

State flow:

```text
waiting -> confirming -> preflop -> flop -> turn -> river -> showdown -> finished
```

Payout notes:

- Default stake is `0.0001 ETH`.
- Developer fee is `2%` of the settled pot.
- Winnings are credited to `pendingWithdrawals`; players claim after the table is finished.
- Private keys are never used in the frontend, `public/config.js`, or GitHub.

## Cloudflare Pages

Required project shape:

```text
public/
functions/_middleware.js
package.json
```

Cloudflare Pages env:

```env
APP_NAME=Poker Clash
APP_URL=https://poker.karos.dpdns.org
BASE_CHAIN_ID=84532
BASE_RPC_URL=https://sepolia.base.org
FARCASTER_NOINDEX=true
GAME_CONTRACT_ADDRESS=0x...
DEFAULT_STAKE_ETH=0.0001
DEFAULT_BET_ETH=0.00001
```

KV:

```text
CHAT_KV
```

`CHAT_KV` is used for lobby/table state and table chat.

## Local Run

```bash
npm install
npm start
```

Open:

```text
http://localhost:4173
```

The local server uses JSON storage in `data/state.json`.

## Deploy Base Sepolia

Copy `.env.example` to `.env` locally and fill only local secrets:

```env
DEPLOYER_PRIVATE_KEY=0x...
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
FEE_RECIPIENT_ADDRESS=0xYourFeeWallet
DEFAULT_STAKE_ETH=0.0001
```

Deploy:

```bash
npm run compile
npm run deploy:base-sepolia
```

The deploy script prints:

```text
GAME_CONTRACT_ADDRESS=0x...
```

Put that address into Cloudflare Pages env as `GAME_CONTRACT_ADDRESS`.

## Checks

```bash
node --check public/app.js
Get-Content functions\_middleware.js | node --input-type=module --check
npm run check:storage
npm run check:miniapp
```

After deploying and setting `GAME_CONTRACT_ADDRESS`:

```bash
npm run check:escrow
```

## URLs To Verify

```text
https://poker.karos.dpdns.org/
https://poker.karos.dpdns.org/config.js
https://poker.karos.dpdns.org/api/health
https://poker.karos.dpdns.org/.well-known/farcaster.json
```
