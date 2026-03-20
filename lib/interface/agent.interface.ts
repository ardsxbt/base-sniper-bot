import { IPairInfo } from './token.interface';

export type TExecutionMode = 'paper' | 'live';

export interface IAgentConfig {
  enabled: boolean;
  executionMode: TExecutionMode;
  minScore: number;
  maxConcurrentPositions: number;
  cooldownMinutes: number;
  defaultBuyEth: number;
  maxBuyEth: number;
  minLiquidityEth: number;
  maxLiquidityEth: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  maxHoldingMinutes: number;
}

export interface IAgentDecision {
  action: 'BUY' | 'SKIP';
  score: number;
  reasons: string[];
  amountEth?: number;
}

export interface IAgentReceipt {
  timestamp: string;
  exchange: string;
  token: string;
  tokenAddress: string;
  pairAddress: string;
  liquidityEth: number;
  decision: IAgentDecision;
  executionMode: TExecutionMode;
  txHash?: string;
  status: 'simulated' | 'submitted' | 'failed' | 'skipped';
  error?: string;
}

export interface IAgentContext {
  pairInfo: IPairInfo;
  exchange: string;
}

export interface IAgentPosition {
  tokenAddress: string;
  symbol: string;
  entryTxHash: string;
  entryPriceUsd?: number;
  entryAmountEth: number;
  openedAt: string;
  status: 'open' | 'closed';
  closeTxHash?: string;
  closeReason?: string;
}
