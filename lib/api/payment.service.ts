import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { config } from '../utils/config';
import { getActiveChain, getActiveChainId, getActiveProvider } from '../utils/chain';

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

interface IPaymentVerifyResult {
  ok: boolean;
  reason?: string;
  paidAmountUsd?: number;
  payer?: string;
}

class PaymentService {
  private usedFile = path.resolve(process.cwd(), 'x402-used-txs.json');

  private getReceiverAddress(): string {
    if (!config.WALLET_PRIVATE_KEY)
      throw new Error('WALLET_PRIVATE_KEY missing for payment receiver');
    return new ethers.Wallet(config.WALLET_PRIVATE_KEY).address.toLowerCase();
  }

  private readUsed(): Set<string> {
    try {
      if (!fs.existsSync(this.usedFile)) return new Set();
      const arr = JSON.parse(fs.readFileSync(this.usedFile, 'utf8')) as string[];
      return new Set(arr.map(x => x.toLowerCase()));
    } catch {
      return new Set();
    }
  }

  private writeUsed(set: Set<string>): void {
    fs.writeFileSync(this.usedFile, JSON.stringify([...set], null, 2), 'utf8');
  }

  async verifyUsdcTransfer(txHash: string, minUsd: number): Promise<IPaymentVerifyResult> {
    const used = this.readUsed();
    const hash = txHash.toLowerCase();
    if (used.has(hash)) {
      return { ok: false, reason: 'payment tx already used' };
    }

    const provider = getActiveProvider();
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return { ok: false, reason: 'payment tx not found' };
    if (receipt.status !== 1) return { ok: false, reason: 'payment tx failed' };

    const usdc = config.USDC_ADDRESS.toLowerCase();
    const receiver = this.getReceiverAddress();

    const toTopic = ethers.zeroPadValue(receiver, 32).toLowerCase();

    const transferLog = receipt.logs.find(
      l =>
        l.address.toLowerCase() === usdc &&
        l.topics.length >= 3 &&
        l.topics[0].toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
        l.topics[2].toLowerCase() === toTopic
    );

    if (!transferLog) {
      return { ok: false, reason: 'no USDC transfer to receiver found in tx' };
    }

    const amountRaw = BigInt(transferLog.data);
    const amountUsd = Number(ethers.formatUnits(amountRaw, 6)); // USDC decimals

    if (amountUsd < minUsd) {
      return { ok: false, reason: `insufficient payment: ${amountUsd} < ${minUsd}` };
    }

    used.add(hash);
    this.writeUsed(used);

    const payerTopic = transferLog.topics[1];
    const payer = ethers.getAddress(`0x${payerTopic.slice(-40)}`);

    return { ok: true, paidAmountUsd: amountUsd, payer };
  }

  getChallenge(priceUsd: number) {
    return {
      error: 'Payment Required',
      accepts: 'x402',
      chain: getActiveChain(),
      chainId: getActiveChainId(),
      token: 'USDC',
      tokenAddress: config.USDC_ADDRESS,
      amountUsd: priceUsd,
      receiver: this.getReceiverAddress(),
      instructions: {
        sendUsdcToReceiver: true,
        thenCallWithHeader: 'x-402-payment: <txHash>',
      },
    };
  }
}

export const paymentService = new PaymentService();
