import axios from 'axios';
import { config } from '../../utils/config';
import { IAgentContext, IAgentDecision, IAgentReceipt } from '../../interface/agent.interface';
import { getNonWETHToken } from '../../contracts/pairAnalyzer';
import { uniswapTradingService } from '../uniswapTrading.service';
import { agentPolicyService } from './policy.service';
import { agentReceiptService } from './receipt.service';
import { agentPositionService } from './position.service';
import { candidateAlertService } from './candidateAlert.service';
import { swapNotifyService } from './swapNotify.service';
import { hookGuardService } from './hookGuard.service';
import { ensService } from '../ens.service';

class DecisionEngineService {
  private lastActionMap = new Map<string, number>();

  private async getEthAmountForUsd(targetUsd: number): Promise<number> {
    try {
      const res = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
        { timeout: 5000 }
      );
      const ethUsd = Number(res.data?.ethereum?.usd);
      if (Number.isFinite(ethUsd) && ethUsd > 0) {
        return targetUsd / ethUsd;
      }
    } catch {
      // ignore and use fallback below
    }

    // conservative fallback (~$1 around $2000/ETH)
    return 0.0005;
  }

  private async getMarketSignals(tokenAddress: string): Promise<{
    volume24hUsd?: number;
    buys24h?: number;
    sells24h?: number;
    priceChange24h?: number;
  }> {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const res = await axios.get(url, { timeout: 6000 });
      const pairs = res.data?.pairs;
      if (!Array.isArray(pairs) || pairs.length === 0) return {};
      const pair = pairs.find((p: any) => p.chainId === 'base') || pairs[0];
      const volume24hUsd = parseFloat(pair?.volume?.h24 || '');
      const buys24h = Number(pair?.txns?.h24?.buys);
      const sells24h = Number(pair?.txns?.h24?.sells);
      const priceChange24h = parseFloat(pair?.priceChange?.h24 || '');

      return {
        volume24hUsd: Number.isFinite(volume24hUsd) ? volume24hUsd : undefined,
        buys24h: Number.isFinite(buys24h) ? buys24h : undefined,
        sells24h: Number.isFinite(sells24h) ? sells24h : undefined,
        priceChange24h: Number.isFinite(priceChange24h) ? priceChange24h : undefined,
      };
    } catch {
      return {};
    }
  }

  private async scoreCandidate(ctx: IAgentContext): Promise<IAgentDecision> {
    const policy = agentPolicyService.getPolicy();
    const token = getNonWETHToken(ctx.pairInfo);
    const reasons: string[] = [];
    let score = 0;

    // 1) Liquidity quality (40)
    const liq = ctx.pairInfo.liquidityETH;
    if (liq >= policy.minLiquidityEth && liq <= policy.maxLiquidityEth) {
      score += 40;
      reasons.push(`+40 liquidity in range (${liq.toFixed(2)} ETH)`);
    } else {
      reasons.push(`+0 liquidity out of range (${liq.toFixed(2)} ETH)`);
    }

    // 2) Contract sanity (20)
    const verified = ctx.pairInfo.token0Verified || ctx.pairInfo.token1Verified;
    if (verified) {
      score += 20;
      reasons.push('+20 contract verified');
    } else {
      reasons.push('+0 contract not verified yet');
    }

    // 3) Metadata sanity (10)
    const hasName = token.name?.length > 2 && token.symbol?.length > 1;
    if (hasName) {
      score += 10;
      reasons.push('+10 metadata sane');
    }

    // 4) Early market behavior (20)
    const signals = await this.getMarketSignals(token.address);
    if ((signals.volume24hUsd || 0) >= 5000) {
      score += 10;
      reasons.push(`+10 volume24h ${(signals.volume24hUsd || 0).toFixed(0)} USD`);
    } else {
      reasons.push(`+0 low volume24h ${(signals.volume24hUsd || 0).toFixed(0)} USD`);
    }

    const buySellRatio =
      (signals.buys24h || 0) > 0 && (signals.sells24h || 0) >= 0
        ? (signals.buys24h || 0) / Math.max(1, signals.sells24h || 0)
        : 0;
    if (buySellRatio >= 0.7) {
      score += 10;
      reasons.push(`+10 buy/sell ratio ${buySellRatio.toFixed(2)}`);
    } else {
      reasons.push(`+0 weak buy/sell ratio ${buySellRatio.toFixed(2)}`);
    }

    // 5) Placeholder holder/flow proxy (10)
    if ((signals.priceChange24h || -999) > -35 && (signals.priceChange24h || 999) < 300) {
      score += 10;
      reasons.push(`+10 price-change sanity ${signals.priceChange24h?.toFixed(2) || 'n/a'}%`);
    } else {
      reasons.push(`+0 unstable price-change ${signals.priceChange24h?.toFixed(2) || 'n/a'}%`);
    }

    // 6) Explicit v4 strategy boost
    if (policy.strategyPath === 'v4_explicit') {
      score += policy.v4ScoreBoost;
      reasons.push(`+${policy.v4ScoreBoost} v4 strategy boost`);
    }

    const cooldownKey = token.address.toLowerCase();
    const lastTs = this.lastActionMap.get(cooldownKey) || 0;
    const cooldownMs = policy.cooldownMinutes * 60 * 1000;
    if (Date.now() - lastTs < cooldownMs) {
      reasons.push('guardrail: cooldown active');
      return { action: 'SKIP', score, reasons };
    }

    if (!agentPositionService.canOpenNewPosition()) {
      reasons.push('guardrail: max concurrent positions reached');
      return { action: 'SKIP', score, reasons };
    }

    if (score >= policy.minScore) {
      if (policy.hookGuardEnabled) {
        const hookPre = hookGuardService.preSwapCheck(ctx);
        reasons.push(hookPre.reason);
        if (!hookPre.pass) {
          return { action: 'SKIP', score, reasons };
        }
      }

      const oneDollarEth = await this.getEthAmountForUsd(1);
      return {
        action: 'BUY',
        score,
        reasons,
        amountEth: Math.min(oneDollarEth, policy.maxBuyEth),
      };
    }

    return { action: 'SKIP', score, reasons };
  }

  async evaluateAndAct(ctx: IAgentContext): Promise<void> {
    const policy = agentPolicyService.getPolicy();

    const token = getNonWETHToken(ctx.pairInfo);
    const decision = await this.scoreCandidate(ctx);

    if (!policy.enabled) {
      decision.action = 'SKIP';
      decision.reasons.push('guardrail: agent disabled');
    }

    const receipt: IAgentReceipt = {
      timestamp: new Date().toISOString(),
      exchange: ctx.exchange,
      token: token.symbol,
      tokenAddress: token.address,
      pairAddress: ctx.pairInfo.pairAddress,
      liquidityEth: ctx.pairInfo.liquidityETH,
      decision,
      executionMode: policy.executionMode,
      strategyPath: policy.strategyPath,
      status: 'skipped',
    };

    try {
      if (decision.score >= policy.minScore) {
        candidateAlertService.push({
          timestamp: new Date().toISOString(),
          token: token.symbol,
          tokenAddress: token.address,
          pairAddress: ctx.pairInfo.pairAddress,
          score: decision.score,
          reasons: decision.reasons,
        });
      }

      if (decision.action !== 'BUY' || !decision.amountEth) {
        agentReceiptService.append(receipt);
        console.log(
          `🤖 SKIP ${token.symbol} | score=${decision.score} | ${decision.reasons.join(' | ')}`
        );
        return;
      }

      const tokenIdentity = await ensService.formatIdentity(token.address);

      if (policy.executionMode === 'paper' || !config.WALLET_PRIVATE_KEY) {
        receipt.status = 'simulated';
        this.lastActionMap.set(token.address.toLowerCase(), Date.now());
        agentReceiptService.append(receipt);
        swapNotifyService.push({
          timestamp: new Date().toISOString(),
          token: token.symbol,
          tokenAddress: token.address,
          amountEth: decision.amountEth,
          mode: 'paper',
          status: 'simulated',
          reason: decision.reasons.join(' | '),
        });
        console.log(
          `🤖 PAPER BUY ${decision.amountEth} ETH of ${token.symbol} [${tokenIdentity}] | score=${decision.score} | ${decision.reasons.join(' | ')}`
        );
        return;
      }

      const buyResult = await uniswapTradingService.buyTokenWithUniswap(
        token.address,
        decision.amountEth,
        policy.strategyPath === 'v4_explicit'
      );

      receipt.status = 'submitted';
      receipt.txHash = buyResult.txHash;
      this.lastActionMap.set(token.address.toLowerCase(), Date.now());
      agentReceiptService.append(receipt);

      const entryPriceUsd = await agentPositionService.getCurrentPriceUsd(token.address);
      agentPositionService.openPosition({
        tokenAddress: token.address,
        symbol: token.symbol,
        entryTxHash: buyResult.txHash,
        entryPriceUsd,
        entryAmountEth: decision.amountEth,
        openedAt: new Date().toISOString(),
        status: 'open',
      });

      swapNotifyService.push({
        timestamp: new Date().toISOString(),
        token: token.symbol,
        tokenAddress: token.address,
        amountEth: decision.amountEth,
        txHash: buyResult.txHash,
        mode: 'live',
        status: 'submitted',
        reason: decision.reasons.join(' | '),
      });

      if (policy.hookGuardEnabled) {
        const post = hookGuardService.postSwapCheck(token.address);
        console.log(`🪝 ${post.reason}`);
      }

      console.log(
        `🤖 LIVE BUY ${decision.amountEth} ETH of ${token.symbol} [${tokenIdentity}] | tx=${buyResult.txHash} | score=${decision.score}`
      );
    } catch (error) {
      receipt.status = 'failed';
      receipt.error = `${error}`;
      agentReceiptService.append(receipt);
      swapNotifyService.push({
        timestamp: new Date().toISOString(),
        token: token.symbol,
        tokenAddress: token.address,
        amountEth: decision.amountEth || 0,
        mode: policy.executionMode,
        status: 'failed',
        reason: `${error}`,
      });
      console.error(`❌ Agent action failed for ${token.symbol}: ${error}`);
    }
  }
}

export const decisionEngineService = new DecisionEngineService();
