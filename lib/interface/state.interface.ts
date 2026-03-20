import { TFactorySelected } from './token.interface';

export interface IState {
  tokenBlacklist?: Array<string>;
  walletAddresses?: Array<string>;
  factorySelected?: Array<TFactorySelected>;
  agentPolicy?: unknown;
  agentPositions?: unknown;
  [key: string]: unknown;
}

export interface IStateServiceOptions {
  configPath?: string;
  autoSave?: boolean;
  encoding?: BufferEncoding;
}
