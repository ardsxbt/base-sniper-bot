# x402 Payment Flow

This document explains how paid API endpoints are protected in Base Hunter Runtime.

## 1) Endpoint Types

### Free endpoints
- `GET /api/v1/health`
- `GET /api/v1/meta`

### Paid endpoints (x402-gated)
- `GET /api/v1/signal/latest`
- `POST /api/v1/analyze`
- `POST /api/v1/execute/buy`

## 2) Toggle

Set in `.env`:

```env
X402_ENABLED=true
```

- `false` → no payment enforcement (dev mode)
- `true` → paid endpoints require verified onchain payment

## 3) Payment Challenge Flow

1. Client calls paid endpoint without payment header
2. Server returns `402 Payment Required` with:
   - chain + chainId
   - token (`USDC`)
   - receiver address
   - required amount
   - usage instruction

3. Client sends USDC transfer onchain to receiver
4. Client retries endpoint with:

```http
x-402-payment: <txHash>
```

## 4) Verification Logic

On retry, server verifies:

- tx exists and succeeded
- tx includes `USDC Transfer` log
- recipient is service receiver wallet
- amount paid meets required USD amount
- tx hash was not used previously (replay protection)

If valid, request proceeds.

## 5) Replay Protection

Used payment tx hashes are stored in:

- `x402-used-txs.json`

A used hash cannot be reused for another paid request.

## 6) Service Receiver

Current receiver = runtime wallet derived from `WALLET_PRIVATE_KEY`.

## 7) Relevant Modules

- `lib/api/x402.middleware.ts`
- `lib/api/payment.service.ts`
- `lib/api/server.ts`
