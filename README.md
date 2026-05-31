# Poker Clash Farcaster Mini App

Poker Clash is a Base Sepolia testnet MVP for a two-player poker table inside one Farcaster Mini App.

The app has two screens:

- `/` lobby: connect wallet and press Start Game.
- `/#/table/:tableId` table: player1/player2, pot, stake, stage, turn, 60 second timer, actions, cards, and table chat.

Money movement is handled by the Solidity contract. Lobby matching, table UI state, Chainlink VRF dealing receipts, prototype cards, and chat are stored in Cloudflare KV on Pages, with local JSON storage for development.

Important: Chainlink VRF improves randomness, but card dealing is still partially off-chain and not full mental poker/ZK. This is fine for Base Sepolia testing, but production poker needs a stronger dealing design.

## Contract

The contract is [contracts/Escrow.sol](contracts/Escrow.sol). The name stays `Escrow` so older scripts still find it.

Main flow:

- `joinTable(bytes32 tableId)` payable: player sends the ETH stake for a table.
- `confirm(bytes32 tableId)`: after both players joined, each player confirms by transaction within 60 seconds.
- `commitSeed(bytes32 tableId,uint256 handId,bytes32 commit)`: commit a hidden local seed before cards are dealt.
- `revealSeed(bytes32 tableId,uint256 handId,string secret)`: reveal the local seed within 60 seconds. After both reveal, the contract requests Chainlink VRF.
- `requestVrfSeed(bytes32 tableId,uint256 handId)`: retry the VRF request if both reveals are present and no request was made.
- `timeoutReveal(bytes32 tableId,uint256 handId)`: punish/refund a stalled commit/reveal phase after timeout.
- `payStreetAnte(bytes32 tableId)` payable: each player sends the small street ante before preflop/flop/turn/river betting opens.
- `check(bytes32 tableId)`: pass action if there is no open bet.
- `bet(bytes32 tableId)` payable: send an ETH bet into the pot.
- `call(bytes32 tableId)` payable: match the open bet.
- `fold(bytes32 tableId)`: fold and settle the pot to the opponent.
- `timeout(bytes32 tableId)`: after 60 seconds of inactivity, the inactive player loses. At showdown, one submitted result can be settled by timeout if the other player is inactive.
- `submitResult(bytes32 tableId,address winner)`: submit the off-chain showdown winner.
- `claimWinnings()`: withdraw settled winnings.

State flow:

```text
waiting -> confirming -> waiting_for_commit -> waiting_for_reveal -> waiting_for_vrf -> seed_ready -> preflop -> flop -> turn -> river -> showdown -> finished
```

Payout notes:

- Default stake is `0.0001 ETH`.
- Default street ante is `DEFAULT_STAKE_ETH / 10`, currently `0.00001 ETH` when the stake is `0.0001 ETH`.
- Developer fee is `2%` of the settled pot.
- Winnings are credited to `pendingWithdrawals`; players claim after the table is finished.
- Private keys are never used in the frontend, `public/config.js`, or GitHub.

## Chainlink VRF Fairness

Before cards are dealt, both players generate a local secret in their browser.

Flow:

- Commit: the browser sends `keccak256(secret + playerAddress + tableId + handId)` to the contract.
- Reveal: after both commits are present, each player reveals the secret within 60 seconds.
- VRF request: after two reveals, the contract requests Chainlink VRF v2.5.
- Seed: when the VRF callback arrives, the contract combines `secret1`, `secret2`, `tableId`, `handId`, `vrfWord`, chain id, and the contract address into one final seed.
- Deck: Cloudflare deterministically shuffles a 52-card deck from that seed, stores the deck hash, and only returns the viewer's own private cards before showdown.
- Verify: after showdown/finish, the UI can recompute commits, VRF seed, deck, and deck hash from the revealed secrets and VRF word.

This prevents one player from choosing a seed after seeing the other seed and removes the old backend/blockhash randomness source. It does not make card custody fully trustless because Cloudflare still performs the final off-chain dealing for this prototype.

Roadmap:

- v2: add stronger card custody and server audit logs around the VRF seed.
- v3: replace off-chain custody with encrypted shuffle / mental poker or ZK-style dealing.

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
ADMIN_TOKEN=generate-a-long-random-secret
```

KV:

```text
CHAT_KV
```

`CHAT_KV` is used for lobby/table state and table chat.

## Admin Bot Testing

Open:

```text
https://poker.karos.dpdns.org/#/admin
```

The admin panel is protected by the server-side `ADMIN_TOKEN`. The token is checked in Cloudflare Functions or the local Node server and must not be committed to GitHub.

Admin bot tables are off-chain simulation tables. Bots do not send blockchain transactions and cannot test real contract settlement. Use them only to check table UX, chat, cards, turn flow, and mobile layout.

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
VRF_SUBSCRIPTION_ID=123
VRF_COORDINATOR=0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE
VRF_KEY_HASH=0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71
VRF_CALLBACK_GAS_LIMIT=300000
VRF_REQUEST_CONFIRMATIONS=3
VRF_NATIVE_PAYMENT=true
```

Create a Chainlink VRF v2.5 subscription first, fund it with testnet ETH/native payment, deploy the contract with the subscription id, then add the deployed contract address as a subscription consumer.

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
npm run check:fair
npm run check:poker-flow
npm run check:miniapp
```

After deploying and setting `GAME_CONTRACT_ADDRESS`:

```bash
npm run check:escrow
# Optional real Base Sepolia E2E; needs DEPLOYER_PRIVATE_KEY and enough testnet ETH.
npm run check:base-sepolia-flow
```

## URLs To Verify

```text
https://poker.karos.dpdns.org/
https://poker.karos.dpdns.org/config.js
https://poker.karos.dpdns.org/api/health
https://poker.karos.dpdns.org/.well-known/farcaster.json
```
