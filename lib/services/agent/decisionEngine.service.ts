import { config } from '../../utils/config';
import { IAgentContext, IAgentDecision, IAgentReceipt } from '../../interface/agent.interface';
import { getNonWETHToken } from '../../contracts/pairAnalyzer';
import { relayService } from '../relay.service';
import { telegramBot } from '../../telegram/telegram';
import { agentPolicyService } from './policy.service';
import { agentReceiptService } from './receipt.service';
import { agentPositionService } from './position.service';

class DecisionEngineService {
  private lastActionMap = new Map<string, number>();

  private scoreCandidate(ctx: IAgentContext): IAgentDecision {
    const policy = agentPolicyService.getPolicy();
    const token = getNonWETHToken(ctx.pairInfo);
    const reasons: string[] = [];
    let score = 0;

    const liq = ctx.pairInfo.liquidityETH;
    if (liq >= policy.minLiquidityEth && liq <= policy.maxLiquidityEth) {
      score += 40;
      reasons.push(`liquidity in range (${liq.toFixed(2)} ETH)`);
    } else {
      reasons.push(`liquidity out of range (${liq.toFixed(2)} ETH)`);
    }

    const verified = ctx.pairInfo.token0Verified || ctx.pairInfo.token1Verified;
    if (verified) {
      score += 20;
      reasons.push('contract verified');
    } else {
      reasons.push('contract not verified yet');
    }

    const hasName = token.name?.length > 2 && token.symbol?.length > 1;
    if (hasName) {
      score += 15;
      reasons.push('token metadata present');
    }

    const cooldownKey = token.address.toLowerCase();
    const lastTs = this.lastActionMap.get(cooldownKey) || 0;
    const cooldownMs = policy.cooldownMinutes * 60 * 1000;
    if (Date.now() - lastTs < cooldownMs) {
      reasons.push('cooldown active');
      return { action: 'SKIP', score, reasons };
    }

    if (!agentPositionService.canOpenNewPosition()) {
      reasons.push('max concurrent positions reached');
      return { action: 'SKIP', score, reasons };
    }

    if (score >= policy.minScore) {
      return {
        action: 'BUY',
        score,
        reasons,
        amountEth: Math.min(policy.defaultBuyEth, policy.maxBuyEth),
      };
    }

    return { action: 'SKIP', score, reasons };
  }

  async evaluateAndAct(ctx: IAgentContext): Promise<void> {
    const policy = agentPolicyService.getPolicy();
    if (!policy.enabled) return;

    const token = getNonWETHToken(ctx.pairInfo);
    const decision = this.scoreCandidate(ctx);

    const receipt: IAgentReceipt = {
      timestamp: new Date().toISOString(),
      exchange: ctx.exchange,
      token: token.symbol,
      tokenAddress: token.address,
      pairAddress: ctx.pairInfo.pairAddress,
      liquidityEth: ctx.pairInfo.liquidityETH,
      decision,
      executionMode: policy.executionMode,
      status: 'skipped',
    };

    try {
      if (decision.action !== 'BUY' || !decision.amountEth) {
        agentReceiptService.append(receipt);
        return;
      }

      if (policy.executionMode === 'paper' || !config.WALLET_PRIVATE_KEY) {
        receipt.status = 'simulated';
        this.lastActionMap.set(token.address.toLowerCase(), Date.now());
        agentReceiptService.append(receipt);
        await telegramBot.sendMessage(
          config.TELEGRAM_CHAT_ID,
          `🤖 Agent decision (paper): BUY ${decision.amountEth} ETH of ${token.symbol}\nScore: ${decision.score}\nReason: ${decision.reasons.join(', ')}`
        );
        return;
      }

      const buyResult = await relayService.buyTokenWithRelayRouter(
        token.address,
        decision.amountEth,
        5
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

      await telegramBot.sendMessage(
        config.TELEGRAM_CHAT_ID,
        `🤖 Agent executed BUY ${decision.amountEth} ETH of ${token.symbol}\nTx: ${buyResult.txHash}`
      );
    } catch (error) {
      receipt.status = 'failed';
      receipt.error = `${error}`;
      agentReceiptService.append(receipt);
      await telegramBot.sendMessage(
        config.TELEGRAM_CHAT_ID,
        `❌ Agent action failed for ${token.symbol}: ${error}`
      );
    }
  }
}

export const decisionEngineService = new DecisionEngineService();
