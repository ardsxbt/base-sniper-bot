import { Request, Response, NextFunction } from 'express';
import { paymentService } from './payment.service';

/**
 * x402 payment gate with onchain USDC transfer verification.
 *
 * Header contract:
 *   x-402-payment: <txHash>
 */
export function requireX402(priceUsd: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const paymentTxHash = req.header('x-402-payment');

    if (!paymentTxHash) {
      return res.status(402).json(paymentService.getChallenge(priceUsd));
    }

    try {
      const verification = await paymentService.verifyUsdcTransfer(paymentTxHash, priceUsd);
      if (!verification.ok) {
        return res.status(402).json({
          ...paymentService.getChallenge(priceUsd),
          reason: verification.reason,
        });
      }

      (req as any).x402 = {
        payer: verification.payer,
        paidAmountUsd: verification.paidAmountUsd,
        txHash: paymentTxHash,
      };

      return next();
    } catch (error) {
      return res.status(500).json({ error: `x402 verification failed: ${error}` });
    }
  };
}
