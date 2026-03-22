import { IPairInfo } from './token.interface';

export type TExecutionMode = 'paper' | 'live';

export type TStrategyPath = 'classic' | 'v4_explicit';

export interface IAgentConfig {
  enabled: boolean;
  executionMode: TExecutionMode;
  strategyPath: TStrategyPath;
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
  v4ScoreBoost: number;
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
  strategyPath: TStrategyPath;
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
