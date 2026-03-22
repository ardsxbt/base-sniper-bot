# Judge Quick Start (5-Min Verification)

This file is a minimal, deterministic verification flow for judges.

## Prerequisites

- Node 18+
- `.env` configured
- Dependencies installed (`npm install`)

## 1) Build

```bash
npm run build
```

Expected: TypeScript compile succeeds.

## 2) Run service

```bash
npm run dev
```

Expected logs include:
- `Base Hunter Runtime initialized and ready to hunt!`
- `AlphaGuard API listening on :8787`

## 3) Verify free API

```bash
curl http://127.0.0.1:8787/api/v1/health
curl http://127.0.0.1:8787/api/v1/meta
```

Expected:
- service metadata JSON
- capabilities include: `signals`, `analyze`, `execute`

## 4) Verify x402 challenge behavior

(when `X402_ENABLED=true`)

```bash
curl -i http://127.0.0.1:8787/api/v1/signal/latest
```

Expected:
- HTTP `402 Payment Required`
- challenge payload with:
  - `chain: base`
  - `token: USDC`
  - `receiver`
  - `amountUsd`
  - `x-402-payment` retry instruction

## 5) Verify paid-call success path

1. Send required USDC amount onchain to challenge `receiver`
2. Retry paid endpoint with payment tx hash:

```bash
curl -X POST http://127.0.0.1:8787/api/v1/analyze \
  -H "Content-Type: application/json" \
  -H "x-402-payment: <txHash>" \
  -d '{"tokenAddress":"0x4200000000000000000000000000000000000006"}'
```

Expected:
- analysis JSON response
- payment context present in response

## Optional: Real swap proof

A real swap transaction example from this runtime:

- `0x7309d3d70bd331e11f62a6dfd96c6a03b2d105b07f254d8c2f2438596001c5cf`

## Troubleshooting

- API not reachable: check service logs
  ```bash
  journalctl -u base-agent.service -n 80 --no-pager
  ```
- x402 disabled unintentionally: ensure `.env` contains `X402_ENABLED=true`
- Port mismatch: verify `API_PORT` in `.env`
