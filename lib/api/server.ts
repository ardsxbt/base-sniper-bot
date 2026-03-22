import express from 'express';
import axios from 'axios';
import { ethers } from 'ethers';
import { config } from '../utils/config';
import { candidateAlertService } from '../services/agent/candidateAlert.service';
import { uniswapTradingService } from '../services/uniswapTrading.service';
import { requireX402 } from './x402.middleware';
import { analyzeToken } from './analyze.service';

function paymentGate(priceUsd: number) {
  return config.X402_ENABLED
    ? requireX402(priceUsd)
    : (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
}

class ApiServer {
  private app = express();

  constructor() {
    this.app.use(express.json());
    this.routes();
  }

  private routes() {
    this.app.get('/api/v1/health', (_req, res) => {
      res.json({
        ok: true,
        service: 'alphaguard-x402',
        version: '1.0.0',
        chain: config.ACTIVE_CHAIN,
      });
    });

    this.app.get('/api/v1/meta', (_req, res) => {
      res.json({
        name: 'AlphaGuard x402',
        description: 'Paid token intelligence and guarded execution on Base/Unichain',
        capabilities: ['signals', 'analyze', 'execute'],
        pricingUsd: { signalLatest: 0.25, analyzeToken: 1, executeGuardedBuy: 2 },
        x402Enabled: config.X402_ENABLED,
      });
    });

    this.app.get('/api/v1/signal/latest', paymentGate(0.25), (req, res) => {
      const minScore = Number(req.query.minScore || 70);
      const limit = Math.min(Number(req.query.limit || 5), 20);
      const items = candidateAlertService
        .readAll()
        .filter(i => i.score >= minScore)
        .slice(-limit)
        .reverse();
      const payment = (req as any).x402;
      res.json({ items, payment });
    });

    this.app.post('/api/v1/analyze', paymentGate(1), async (req, res) => {
      try {
        const tokenAddress = String(req.body?.tokenAddress || '');
        if (!ethers.isAddress(tokenAddress)) {
          return res.status(400).json({ error: 'invalid tokenAddress' });
        }
        const result = await analyzeToken(tokenAddress);
        return res.json({ ...result, payment: (req as any).x402 });
      } catch (error) {
        return res.status(500).json({ error: String(error) });
      }
    });

    this.app.post('/api/v1/execute/buy', paymentGate(2), async (req, res) => {
      try {
        const tokenAddress = String(req.body?.tokenAddress || '');
        const amountUsd = Number(req.body?.amountUsd || 1);
        if (!ethers.isAddress(tokenAddress)) {
          return res.status(400).json({ error: 'invalid tokenAddress' });
        }
        if (!(amountUsd > 0 && amountUsd <= 25)) {
          return res.status(400).json({ error: 'amountUsd must be >0 and <=25' });
        }

        const eth = await axios.get(
          'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
          { timeout: 6000 }
        );
        const ethUsd = Number(eth.data?.ethereum?.usd);
        if (!Number.isFinite(ethUsd) || ethUsd <= 0) {
          return res.status(500).json({ error: 'failed to fetch ETH price' });
        }

        const amountEth = amountUsd / ethUsd;
        const result = await uniswapTradingService.buyTokenWithUniswap(
          tokenAddress,
          amountEth,
          true
        );

        return res.json({
          status: 'submitted',
          txHash: result.txHash,
          amountEth,
          token: result.tokenInfo.symbol,
          chain: config.ACTIVE_CHAIN,
          payment: (req as any).x402,
        });
      } catch (error) {
        return res.status(500).json({ error: String(error) });
      }
    });
  }

  start() {
    this.app.listen(config.API_PORT, () => {
      console.log(`🌐 AlphaGuard API listening on :${config.API_PORT}`);
    });
  }
}

export const apiServer = new ApiServer();
