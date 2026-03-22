# Base Hunter Runtime

Production-oriented autonomous agent runtime for onchain token discovery, scoring, guarded execution, and paid API access.

Built for Base-first monitoring, Uniswap-powered execution, and hackathon-grade verifiable workflows.

---

## 1) What this app does

Base Hunter Runtime continuously monitors newly created pools, scores opportunities using deterministic risk rules, and can execute micro-sized swaps with strict policy guardrails.

It also exposes an **x402-ready service API** so other agents/humans can pay for token signals, risk analysis, and guarded execution endpoints.

Core goals:
- Detect opportunities early
- Reduce rug-risk with explicit scoring + guardrails
- Execute safely with small position sizing
- Keep an auditable trail (logs/receipts)

---

## 2) Main features

### A. Onchain monitoring
- Uniswap V2 `PairCreated` monitoring (Base)
- Uniswap V3 `PoolCreated` + first-liquidity detection (Base)
- Uniswap V4 `Initialize` monitoring via PoolManager (Base)
- V4 post-initialize follow-up liquidity refresh (45s/120s) for better scoring context
- Liquidity range filtering

### B. Strategy & scoring engine
- Deterministic token scoring model (0–100)
- Guardrails to force SKIP under unsafe conditions
- Optional explicit `v4` strategy path (`strategyPath=v4_explicit`)
- Hook-aware pre/post risk gating (`hookGuardEnabled`)

### C. Execution engine (Uniswap)
- Uniswap Trading API integration (real API key)
- Permit2-aware signing flow when quote contains permit data
- Slippage fallback quote retries
- Buy and sell execution path with transaction receipts

### D. Position management
- Max concurrent positions
- Cooldown per token
- Take-profit / stop-loss
- Max-holding-time auto close

### E. Service API (x402-ready)
- Public health/meta endpoints
- Paid signal and analysis endpoints
- Paid guarded buy endpoint
- Optional payment gate behavior via `X402_ENABLED`

### F. Multi-chain execution adapter
- Active execution chain switch: `base | unichain`
- Chain-aware quote/swap path

> Note: discovery monitoring is Base-first. V4 initialize events can arrive before full liquidity context; runtime now performs delayed follow-up checks (45s and 120s) to refresh estimated liquidity and rescore.

---

## 3) Architecture (high level)

1. **Event Monitor**
   - listens to new pool/pair events
2. **Decision Engine**
   - scores candidate
   - applies guardrails
3. **Execution Layer**
   - quote → sign (if needed) → swap via Uniswap API
4. **Position Manager**
   - periodic TP/SL/max-holding checks
5. **Service API**
   - paid endpoints for agents/humans
6. **Persistence / Receipts**
   - state + decision/execution logs

---

## 4) Token scoring model

Current scoring model totals **0–100**:

1. **Liquidity quality**: +40  
   +40 if liquidity in configured range, else +0

2. **Contract verification**: +20  
   +20 if verification detected, else +0

3. **Metadata sanity**: +10  
   +10 for valid name/symbol metadata, else +0

4. **24h volume**: +10  
   +10 if volume threshold met, else +0

5. **Buy/Sell pressure**: +10  
   +10 if buy/sell ratio threshold met, else +0

6. **Price-change sanity**: +10  
   +10 if movement is in acceptable window, else +0

7. **v4 strategy boost**: `+v4ScoreBoost` (policy-driven)

### Buy trigger
Candidate becomes BUY only if:
- `score >= minScore`
- all guardrails pass

### Guardrails that force SKIP
- Agent disabled
- Cooldown active
- Max concurrent positions reached
- Hook pre-swap gate fails (when enabled)

---

## 5) API documentation (x402-ready)

Base URL (local):
`http://localhost:8787/api/v1`

### Free endpoints

#### `GET /health`
Returns service health/version/active chain.

#### `GET /meta`
Returns capabilities + pricing + x402 mode.

### Paid endpoints (x402-gated when enabled)

#### `GET /signal/latest`
Returns latest high-score candidate alerts.

Query:
- `minScore` (default: 70)
- `limit` (default: 5, max: 20)

#### `POST /analyze`
Deep analysis for one token.

Body:
```json
{ "tokenAddress": "0x..." }
```

#### `POST /execute/buy`
Guarded buy execution.

Body:
```json
{ "tokenAddress": "0x...", "amountUsd": 1 }
```

### x402 behavior
- `X402_ENABLED=false`: endpoints run without payment gate (dev/test mode)
- `X402_ENABLED=true`: paid endpoints return `402 Payment Required` without payment header

> Current middleware is scaffold-level and intentionally simple for hackathon iteration.

---

## 6) ENS integration

Runtime includes ENS helper module:
- forward resolve (`name -> address`)
- reverse resolve (`address -> name`)
- identity formatting for execution logs

Log style example:
`token.eth (0xabc...1234)` fallback to short hex if ENS unavailable.

---

## 7) Configuration

Copy env template:
```bash
cp .env.example .env
```

Important variables:
- `ACTIVE_CHAIN=base|unichain`
- `BASE_MAINET_RPC_URL`
- `UNICHAIN_RPC_URL`
- `ALCHEMY_WS_URL`
- `ALCHEMY_HTTP_URL`
- `WALLET_PRIVATE_KEY`
- `UNISWAP_API_KEY`
- `UNISWAP_ROUTER_VERSION`
- `API_PORT` (default 8787)
- `X402_ENABLED=true|false`
- `MIN_LIQUIDITY_ETH`
- `MAX_LIQUIDITY_ETH`

---

## 8) Runtime modes

Service-only runtime (no Telegram mode).

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

Systemd unit is supported (`base-agent.service`).

---

## 9) State & output files

State file by environment:
- `state.json` (production)
- `state-dev.json` (non-production)

Common outputs:
- `agent_log.json` — decision/execution receipts
- `pending-candidate-alerts.json` — candidate queue
- `pending-swap-notify.json` — swap notification queue

---

## 10) Quick verification checklist

1. Start service
2. `GET /api/v1/health`
3. `GET /api/v1/meta`
4. Trigger/analyze a token via `/api/v1/analyze`
5. Confirm logs are written
6. Confirm Uniswap quote path works with configured API key

---

## 11) Security notes

- Never commit secrets (`.env`, private keys, API keys)
- Use minimal execution amounts in live mode
- Keep strict guardrails enabled in production
- Monitor and rotate API keys as needed

---

## 12) License / disclaimer

MIT License.  
Educational/experimental software — use at your own risk.
