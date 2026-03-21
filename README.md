# Base Sniper Bot / Agent Runtime 🎯

Minimal Base-chain monitoring + execution bot, now with **service mode** for autonomous agent operation (no Telegram required).

## What it can do

### Core monitoring
- Uniswap V2 `PairCreated` listener (Base)
- Uniswap V3 `PoolCreated` + first Mint liquidity detection
- Liquidity window filtering: `MIN_LIQUIDITY_ETH < liquidity < MAX_LIQUIDITY_ETH`
- Optional token contract verification check (Etherscan)

### Trading execution
- Relay-based buy/sell on Base (default)
- Optional Uniswap Trading API path (`USE_UNISWAP_TRADING_API=true`)
- Permit2 signing-aware swap request flow for Uniswap route types
- Slippage control
- Sell `max` support

### Autonomous agent layer (new)
- Candidate scoring + policy-driven decision (`BUY` / `SKIP`)
- Execution modes:
  - `paper` (simulation only)
  - `live` (real on-chain execution)
- Position management:
  - max concurrent positions
  - take-profit (TP)
  - stop-loss (SL)
  - max holding time auto-close
- Receipt logging to `agent_log.json`

### Optional Telegram mode
Telegram command interface still exists, but is optional.
In service mode, Telegram is disabled automatically.

---

## Run modes

## 1) Service mode (recommended for agent runtime)
No Telegram bot needed.

```bash
SERVICE_MODE=true npm run dev
```

Behavior:
- Starts monitoring runtime internally
- Runs decision engine + policy checks
- Runs TP/SL/max-holding position loop
- Writes receipts to `agent_log.json`

## 2) Telegram mode (legacy/manual control)
Requires valid Telegram bot token/chat id.

```bash
npm run dev
```

---

## Requirements

- Node 18+
- Base RPC / provider endpoints (Alchemy or other)
- Wallet private key (only for `live` execution)
- Etherscan API key (optional but recommended)
- Telegram token/chat only if using Telegram mode

---

## Quick start

1. Clone + install
```bash
git clone <repo-url>
cd base-sniper-bot
npm install
```

2. Create env
```bash
cp .env.example .env
```

3. Start in safe mode (service + paper)
```bash
SERVICE_MODE=true npm run dev
```

4. Build check
```bash
npm run build
```

---

## Key config

Uniswap deep-stack toggle:
- `USE_UNISWAP_TRADING_API=false` (default Relay path)
- Set `true` + provide `UNISWAP_API_KEY` to use Uniswap Trading API execution path
- `UNISWAP_ROUTER_VERSION` defaults to `2.0`


From `.env`:

- `SERVICE_MODE=true` → disable Telegram polling, run internal runtime
- `ALCHEMY_WS_URL`, `ALCHEMY_HTTP_URL`, `BASE_MAINET_RPC_URL` → chain connectivity
- `WALLET_PRIVATE_KEY` → required for live transactions
- `MIN_LIQUIDITY_ETH`, `MAX_LIQUIDITY_ETH` → pool filter

Agent policy is stored in state (`agentPolicy`) and includes:
- `enabled`
- `executionMode` (`paper` or `live`)
- `minScore`
- `maxConcurrentPositions`
- `defaultBuyEth`, `maxBuyEth`
- `takeProfitPercent`, `stopLossPercent`
- `maxHoldingMinutes`

---

## State and logs

State file selected by `NODE_ENV`:

| Environment | File |
|---|---|
| production | `state.json` |
| non-production | `state-dev.json` |

Runtime outputs:
- `agent_log.json` → autonomous decision/execution receipts

Minimal state starter:

```json
{
  "tokenBlacklist": [],
  "walletAddresses": [],
  "factorySelected": ["uniswapV2", "uniswapV3"],
  "agentPolicy": {
    "enabled": false,
    "executionMode": "paper"
  },
  "agentPositions": []
}
```

---

## Scripts

```bash
npm run dev      # nodemon + ts-node
npm run dev:ts   # ts-node once
npm run build    # tsc compile to dist
npm start        # production (needs build)
npm run lint
```

---

## Safety notes

- Start with `executionMode=paper`
- Enable `live` only after validating logs and policy
- Use small default buy size when testing live
- Keep private keys and API keys out of git

---

## Disclaimer

Educational use only. No warranty. You assume all risk.

MIT License.
