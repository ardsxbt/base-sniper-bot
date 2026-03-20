import axios from 'axios';
import { relayService } from '../relay.service';
import { stateService } from '../state.service';
import { telegramBot } from '../../telegram/telegram';
import { config } from '../../utils/config';
import { IAgentPosition } from '../../interface/agent.interface';
import { agentPolicyService } from './policy.service';

class AgentPositionService {
  private key = 'agentPositions';

  getPositions(): IAgentPosition[] {
    return (stateService.get<IAgentPosition[]>(this.key) || []).map(p => ({ ...p }));
  }

  private save(positions: IAgentPosition[]): void {
    stateService.set(this.key, positions);
  }

  getOpenPositions(): IAgentPosition[] {
    return this.getPositions().filter(p => p.status === 'open');
  }

  openPosition(position: IAgentPosition): void {
    const positions = this.getPositions();
    positions.push(position);
    this.save(positions);
  }

  async closePosition(tokenAddress: string, reason: string): Promise<string> {
    const positions = this.getPositions();
    const idx = positions.findIndex(
      p => p.status === 'open' && p.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    );
    if (idx < 0) throw new Error('Open position not found');

    const result = await relayService.sellTokenWithRelayRouter(tokenAddress, 'max', 5);
    positions[idx].status = 'closed';
    positions[idx].closeTxHash = result.txHash;
    positions[idx].closeReason = reason;
    this.save(positions);
    return result.txHash;
  }

  canOpenNewPosition(): boolean {
    const policy = agentPolicyService.getPolicy();
    return this.getOpenPositions().length < policy.maxConcurrentPositions;
  }

  async getCurrentPriceUsd(tokenAddress: string): Promise<number | undefined> {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const res = await axios.get(url, { timeout: 7000 });
      const pairs = res.data?.pairs;
      if (!Array.isArray(pairs) || pairs.length === 0) return undefined;
      const pair = pairs.find((p: any) => p.chainId === 'base') || pairs[0];
      const px = parseFloat(pair?.priceUsd || '');
      return Number.isFinite(px) ? px : undefined;
    } catch {
      return undefined;
    }
  }

  async evaluateRiskAndClose(): Promise<void> {
    const policy = agentPolicyService.getPolicy();
    if (!policy.enabled || policy.executionMode !== 'live') return;

    const openPositions = this.getOpenPositions();
    for (const pos of openPositions) {
      try {
        const now = Date.now();
        const opened = new Date(pos.openedAt).getTime();
        const heldMinutes = (now - opened) / 60000;

        if (heldMinutes >= policy.maxHoldingMinutes) {
          const tx = await this.closePosition(pos.tokenAddress, `Max holding ${policy.maxHoldingMinutes}m`);
          await telegramBot.sendMessage(
            config.TELEGRAM_CHAT_ID,
            `⏱️ Closed ${pos.symbol} by max holding rule\nTx: ${tx}`
          );
          continue;
        }

        if (!pos.entryPriceUsd) continue;
        const currentPrice = await this.getCurrentPriceUsd(pos.tokenAddress);
        if (!currentPrice) continue;

        const pnlPercent = ((currentPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
        if (pnlPercent >= policy.takeProfitPercent) {
          const tx = await this.closePosition(pos.tokenAddress, `Take profit ${policy.takeProfitPercent}%`);
          await telegramBot.sendMessage(
            config.TELEGRAM_CHAT_ID,
            `💰 TP hit for ${pos.symbol} (+${pnlPercent.toFixed(2)}%)\nTx: ${tx}`
          );
          continue;
        }

        if (pnlPercent <= -policy.stopLossPercent) {
          const tx = await this.closePosition(pos.tokenAddress, `Stop loss ${policy.stopLossPercent}%`);
          await telegramBot.sendMessage(
            config.TELEGRAM_CHAT_ID,
            `🛑 SL hit for ${pos.symbol} (${pnlPercent.toFixed(2)}%)\nTx: ${tx}`
          );
          continue;
        }
      } catch (error) {
        await telegramBot.sendMessage(
          config.TELEGRAM_CHAT_ID,
          `⚠️ Position manager error for ${pos.symbol}: ${error}`
        );
      }
    }
  }
}

export const agentPositionService = new AgentPositionService();
