import { IUserTokenInfo } from './token.interface';

export interface IUniswapQuoteResponse {
  routing: string;
  quote: Record<string, unknown>;
  permitData?: Record<string, unknown> | null;
}

export interface IUniswapSwapTransaction {
  to: string;
  from: string;
  data: string;
  value: string;
  chainId: number;
  gasLimit?: string;
}

export interface IUniswapSwapResponse {
  swap: IUniswapSwapTransaction;
}

export interface IUniswapSwapResult {
  txHash: string;
  tokenInfo: IUserTokenInfo;
}
