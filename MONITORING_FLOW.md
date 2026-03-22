# Monitoring Flow

This document explains how Base Hunter Runtime discovers tokens, scores them, and decides whether to execute.

## 1) Event Sources

Base Hunter Runtime listens to:

- **Uniswap V2** `PairCreated`
- **Uniswap V3** `PoolCreated` (+ first liquidity signal)
- **Uniswap V4** `Initialize` (plus delayed follow-up liquidity refresh)

## 2) Candidate Pipeline

1. New pool/pair event is detected
2. Token metadata is fetched
3. Blacklist and basic sanity filters run
4. Candidate enters decision engine

## 3) Scoring Engine (0–100)

Current weighted scoring:

- Liquidity quality: +40
- Contract verification: +20
- Metadata sanity: +10
- 24h volume: +10
- Buy/Sell pressure: +10
- Price-change sanity: +10
- Optional `v4ScoreBoost` when `strategyPath=v4_explicit`

## 4) Guardrails

Even high-score candidates are skipped if guardrails fail:

- Agent disabled
- Cooldown active
- Max concurrent positions reached
- Hook pre-swap gate fails (`hookGuardEnabled=true`)

## 5) Execution Path

If candidate passes:

1. Buy amount is computed (micro-sized, ~$1 policy flow)
2. Execution routed through Uniswap Trading API
3. Transaction hash and decision receipt saved
4. Position manager starts TP/SL/max-holding supervision

## 6) V4 Follow-up Liquidity Rescoring

V4 initialize events can arrive before full liquidity context.
Runtime schedules delayed follow-ups (~45s and ~120s) to refresh estimated liquidity and re-run candidate handling.

## 7) Output Artifacts

- `agent_log.json` — decision/execution receipts
- `pending-candidate-alerts.json` — candidate queue
- `pending-swap-notify.json` — swap notification queue

## 8) Relevant Runtime Modules

- `lib/services/monitoring/tokenMonitoring.service.ts`
- `lib/services/agent/decisionEngine.service.ts`
- `lib/services/agent/position.service.ts`
- `lib/services/agent/hookGuard.service.ts`
