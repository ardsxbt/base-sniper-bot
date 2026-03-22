import axios from 'axios';
import { ethers } from 'ethers';
import { config } from '../utils/config';
import { getActiveChainId, getActiveChain, getActiveProvider } from '../utils/chain';
import { checkUserTokenInfo } from './info.service';
import {
  IUniswapQuoteResponse,
  IUniswapSwapResponse,
  IUniswapSwapResult,
} from '../interface/uniswap.interface';

const UNISWAP_API = 'https://trade-api.gateway.uniswap.org/v1';

class UniswapTradingService {
  private wallet: ethers.Wallet;

  constructor() {
    if (!config.WALLET_PRIVATE_KEY) throw new Error('WALLET_PRIVATE_KEY not configured');
    this.wallet = new ethers.Wallet(config.WALLET_PRIVATE_KEY, getActiveProvider());
  }

  private headers() {
    if (!config.UNISWAP_API_KEY) throw new Error('UNISWAP_API_KEY missing');
    return {
      'Content-Type': 'application/json',
      'x-api-key': config.UNISWAP_API_KEY,
      'x-universal-router-version': config.UNISWAP_ROUTER_VERSION,
    };
  }

  private isUniswapXRouting(routing: string): boolean {
    return ['DUTCH_V2', 'DUTCH_V3', 'PRIORITY'].includes(routing);
  }

  private async checkApproval(token: string, amount: string): Promise<void> {
    if (token.toLowerCase() === config.ETH_ADDRESS.toLowerCase()) return;
    const res = await axios.post(
      `${UNISWAP_API}/check_approval`,
      {
        walletAddress: this.wallet.address,
        token,
        amount,
        chainId: getActiveChainId(),
      },
      { headers: this.headers() }
    );

    const approval = res.data?.approval;
    if (!approval) return;

    const tx = await this.wallet.sendTransaction({
      to: approval.to,
      data: approval.data,
      value: BigInt(approval.value || '0'),
      chainId: getActiveChainId(),
    });
    await tx.wait();
  }

  private async quote(
    tokenIn: string,
    tokenOut: string,
    amount: string,
    preferV4 = false
  ): Promise<IUniswapQuoteResponse> {
    const slippageCandidates = [0.5, 1, 3];
    let last: IUniswapQuoteResponse | undefined;

    for (const slippageTolerance of slippageCandidates) {
      const basePayload: Record<string, unknown> = {
        swapper: this.wallet.address,
        tokenIn,
        tokenOut,
        tokenInChainId: String(getActiveChainId()),
        tokenOutChainId: String(getActiveChainId()),
        amount,
        type: 'EXACT_INPUT',
        slippageTolerance,
        routingPreference: 'BEST_PRICE',
      };

      let res;
      try {
        const payload = preferV4 ? { ...basePayload, protocols: ['V4', 'V3', 'V2'] } : basePayload;
        res = await axios.post(`${UNISWAP_API}/quote`, payload, { headers: this.headers() });
      } catch (e) {
        // fallback to default quote shape in case protocol filtering is unsupported
        res = await axios.post(`${UNISWAP_API}/quote`, basePayload, { headers: this.headers() });
      }

      const quote = res.data as IUniswapQuoteResponse;
      last = quote;
      const failureReasons = ((quote as any).quote?.txFailureReasons || []) as string[];
      if (!failureReasons.includes('SIMULATION_ERROR')) {
        return quote;
      }
    }

    if (!last) throw new Error('Failed to get Uniswap quote');
    return last;
  }

  private async signPermitIfNeeded(quote: IUniswapQuoteResponse): Promise<string | undefined> {
    const permit = quote.permitData;
    if (!permit || typeof permit !== 'object') return undefined;

    const domain = (permit as any).domain;
    const types = (permit as any).types;
    const values = (permit as any).values;
    if (!domain || !types || !values) return undefined;

    return this.wallet.signTypedData(domain, types, values);
  }

  private async swapFromQuote(quote: IUniswapQuoteResponse, signature?: string): Promise<string> {
    const { permitData, ...cleanQuote } = quote as any;
    const request: Record<string, unknown> = { ...cleanQuote };

    if (this.isUniswapXRouting(quote.routing)) {
      if (signature) request.signature = signature;
    } else if (signature && permitData && typeof permitData === 'object') {
      request.signature = signature;
      request.permitData = permitData;
    }

    const res = await axios.post(`${UNISWAP_API}/swap`, request, {
      headers: this.headers(),
    });

    const swap = (res.data as IUniswapSwapResponse).swap;
    if (!swap?.data || swap.data === '0x') throw new Error('Empty swap data from Uniswap API');

    const tx = await this.wallet.sendTransaction({
      to: swap.to,
      data: swap.data,
      value: BigInt(swap.value || '0'),
      chainId: getActiveChainId(),
    });
    await tx.wait();
    return tx.hash;
  }

  async buyTokenWithUniswap(
    tokenAddress: string,
    ethAmount: number,
    preferV4 = false
  ): Promise<IUniswapSwapResult> {
    console.log(
      `🦄 Uniswap buy on ${getActiveChain()} | chainId=${getActiveChainId()} | token=${tokenAddress}`
    );
    const normalizedEthAmount = Math.max(0, Number(ethAmount));
    const amountEthStr = normalizedEthAmount.toFixed(12).replace(/\.?0+$/, '');
    const amount = ethers.parseEther(amountEthStr).toString();
    const quote = await this.quote(config.ETH_ADDRESS, tokenAddress, amount, preferV4);
    const signature = await this.signPermitIfNeeded(quote);
    const txHash = await this.swapFromQuote(quote, signature);
    const tokenInfo = await checkUserTokenInfo(tokenAddress);
    return { txHash, tokenInfo };
  }

  async sellTokenWithUniswap(
    tokenAddress: string,
    tokenAmount: string,
    preferV4 = false
  ): Promise<IUniswapSwapResult> {
    console.log(
      `🦄 Uniswap sell on ${getActiveChain()} | chainId=${getActiveChainId()} | token=${tokenAddress}`
    );
    const tokenInfo = await checkUserTokenInfo(tokenAddress);
    const amount =
      tokenAmount.toLowerCase() === 'max'
        ? tokenInfo.balance.toString()
        : ethers.parseUnits(tokenAmount, tokenInfo.decimals).toString();

    await this.checkApproval(tokenAddress, amount);

    const quote = await this.quote(tokenAddress, config.ETH_ADDRESS, amount, preferV4);
    const signature = await this.signPermitIfNeeded(quote);
    const txHash = await this.swapFromQuote(quote, signature);
    const updated = await checkUserTokenInfo(tokenAddress);
    return { txHash, tokenInfo: updated };
  }
}

export const uniswapTradingService = new UniswapTradingService();
