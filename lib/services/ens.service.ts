import { ethers } from 'ethers';
import { getActiveProvider } from '../utils/chain';

class EnsService {
  private provider = getActiveProvider();

  isEnsName(input: string): boolean {
    return input.includes('.') && !ethers.isAddress(input);
  }

  async resolveName(nameOrAddress: string): Promise<string> {
    if (ethers.isAddress(nameOrAddress)) return nameOrAddress;
    if (!this.isEnsName(nameOrAddress)) {
      throw new Error(`Not a valid address or ENS name: ${nameOrAddress}`);
    }

    const resolved = await this.provider.resolveName(nameOrAddress);
    if (!resolved) throw new Error(`ENS name not resolved: ${nameOrAddress}`);
    return resolved;
  }

  async reverseResolve(address: string): Promise<string | null> {
    if (!ethers.isAddress(address)) return null;
    try {
      return await this.provider.lookupAddress(address);
    } catch {
      return null;
    }
  }

  async formatIdentity(address: string): Promise<string> {
    if (!ethers.isAddress(address)) return address;
    const ens = await this.reverseResolve(address);
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    return ens ? `${ens} (${short})` : short;
  }
}

export const ensService = new EnsService();
