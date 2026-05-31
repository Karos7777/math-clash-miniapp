# Poker Clash Farcaster Mini App

Poker Clash is a six-seat on-chain ETH poker table for Base Sepolia. It is not the old arithmetic game anymore. Players choose the low-limit 6-max table, sit with an ETH buy-in, and every ante/bet/call/raise sends real ETH into the current hand pot.

The current hand mechanic is commit-reveal bluff poker: each active player secretly commits to a hidden hand strength from `1` to `10`, then players can check, bet, call, raise, or fold. Reveal/fold settles that hand.

## Contract

The contract is [contracts/Escrow.sol](contracts/Escrow.sol). The name stays `Escrow` so existing scripts still find it.

Core flow:

- `joinGame()` payable: sit at one of 6 seats with the low-limit buy-in.
- `topUpStack()` payable: add more ETH to your table stack.
- `payAnte()` payable: confirm the new hand and send the small ante transaction into the pot.
- `commitNumber(bytes32)`: commit `keccak256(abi.encodePacked(number, salt))`.
- `check()`: pass if no one has bet yet.
- `bet(uint256)` payable: send the first ETH bet into the hand pot.
- `call()` payable: send matching ETH into the hand pot.
- `raiseBet(uint256)` payable: send extra ETH and raise the required call amount.
- `fold()`: fold and leave your contributed ETH in the hand pot.
- `reveal(uint8,bytes32)`: reveal hidden hand and salt.
- `timeout()`: after 5 minutes of inactivity, opponent wins the hand.
- `cashOutStack()`: close the table and return remaining table stacks.
- `claimWinnings()`: fallback claim if a direct ETH payout could not be delivered.

State machine:

```text
WAITING -> HAND_ANTE -> HAND_COMMIT -> HAND_BET -> HAND_REVEAL -> HAND_SETTLED
HAND_SETTLED -> HAND_ANTE
HAND_SETTLED -> TABLE_CLOSED
```

Payout notes:

- Every hand settles independently.
- A hand starts only after players confirm by sending `payAnte()`.
- The hand pot is paid when the hand is settled.
- Creator fee is `2%` of every settled hand pot.
- If direct ETH transfer fails, the amount is credited to `pendingWithdrawals` and can be claimed.
- Private keys are not used in the frontend.

## Local Run

```bash
npm install
npm start
```

Open:

```text
http://localhost:4173
```

## Deploy Base Sepolia

Copy `.env.example` to `.env` and fill only local secrets:

```env
DEPLOYER_PRIVATE_KEY=
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
FEE_RECIPIENT_ADDRESS=0xYourFeeWallet
LOW_LIMIT_ANTE_ETH=0.00001
LOW_LIMIT_BUY_IN_ETH=0.0001
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

For Render, set that as an environment variable:

```env
GAME_CONTRACT_ADDRESS=0xYourNewContract
```

The server generates `/config.js` from public environment values. It does not expose private keys.

## Checks

```bash
npm run compile
npm run check:miniapp
npm run check:resolver
npm run check:matchmaking
```

Run this only after deploying the new poker contract and setting `GAME_CONTRACT_ADDRESS`:

```bash
npm run check:escrow
```

## Farcaster

Set:

```env
APP_NAME=Poker Clash
APP_URL=https://your-render-domain.onrender.com
FARCASTER_NOINDEX=true
```

After the HTTPS domain is final, generate Farcaster account association values:

```env
FARCASTER_ACCOUNT_ASSOCIATION_HEADER=
FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD=
FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE=
```

## Important

The app also includes a persistent lobby/table chat through the Node server. The old arithmetic question system, ERC-20 approve/deposit flow, backend resolver payout, XP quests, and off-chain winner determination are no longer part of the primary game. The frontend talks directly to the on-chain poker table contract for money movement.
