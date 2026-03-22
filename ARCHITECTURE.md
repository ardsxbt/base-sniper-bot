# Architecture (One-Page)

Base Hunter Runtime is a service-mode autonomous agent with onchain monitoring, deterministic scoring, guarded execution, and paid API access.

## System flow

```text
┌───────────────────────────────┐
│  Onchain Event Sources        │
│  - Uniswap V2 PairCreated     │
│  - Uniswap V3 PoolCreated     │
│  - Uniswap V4 Initialize      │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ Monitoring Layer              │
│ tokenMonitoring.service.ts    │
│ - parses pool/token metadata  │
│ - triggers candidate pipeline │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ Decision Engine               │
│ decisionEngine.service.ts     │
│ - score(0..100)               │
│ - guardrails (cooldown, cap)  │
│ - hook-aware precheck         │
│ - strategyPath (classic/v4)   │
└───────────────┬───────────────┘
        SKIP    │    BUY
                ▼
┌───────────────────────────────┐
│ Execution Layer               │
│ uniswapTrading.service.ts     │
│ - quote / permit / swap       │
│ - Base/Unichain adapter       │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ Position Manager              │
│ position.service.ts           │
│ - TP / SL / max-holding       │
│ - auto close logic            │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ Receipts & Queues             │
│ - agent_log.json              │
│ - pending-candidate-alerts    │
│ - pending-swap-notify         │
└───────────────────────────────┘
```

## Paid service path (x402)

```text
Client --> /api/v1/* paid route --> x402 middleware
       <-- 402 challenge (token, receiver, amount)
Client pays USDC onchain and retries with x-402-payment: <txHash>
Middleware verifies tx logs + amount + replay protection
-> request proceeds
```

## Key runtime modules

- `lib/services/monitoring/tokenMonitoring.service.ts`
- `lib/services/agent/decisionEngine.service.ts`
- `lib/services/agent/position.service.ts`
- `lib/services/agent/hookGuard.service.ts`
- `lib/services/uniswapTrading.service.ts`
- `lib/api/server.ts`
- `lib/api/x402.middleware.ts`
- `lib/api/payment.service.ts`

## Deployment model

- Process manager: `systemd` (`base-agent.service`)
- Mode: service-only (no Telegram runtime dependency)
- API: Express server (default port `8787`)
