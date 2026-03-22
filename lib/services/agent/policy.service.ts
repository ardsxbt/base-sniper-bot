import { IAgentConfig } from '../../interface/agent.interface';
import { stateService } from '../state.service';

const DEFAULT_POLICY: IAgentConfig = {
  enabled: false,
  executionMode: 'paper',
  strategyPath: 'classic',
  minScore: 65,
  maxConcurrentPositions: 3,
  cooldownMinutes: 15,
  defaultBuyEth: 0.005,
  maxBuyEth: 0.02,
  minLiquidityEth: 0.3,
  maxLiquidityEth: 25,
  takeProfitPercent: 30,
  stopLossPercent: 15,
  maxHoldingMinutes: 180,
  v4ScoreBoost: 8,
};

class AgentPolicyService {
  getPolicy(): IAgentConfig {
    const current = stateService.get<IAgentConfig>('agentPolicy');
    return { ...DEFAULT_POLICY, ...(current || {}) };
  }

  setPolicy(patch: Partial<IAgentConfig>): IAgentConfig {
    const next = { ...this.getPolicy(), ...patch };
    stateService.set('agentPolicy', next);
    return next;
  }

  isEnabled(): boolean {
    return this.getPolicy().enabled;
  }
}

export const agentPolicyService = new AgentPolicyService();
