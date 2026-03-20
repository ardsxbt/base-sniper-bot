import { walletMonitoringService } from './services/monitoring/walletMonitoring.service';
import { telegramService } from './telegram/telegram';
import { agentPositionService } from './services/agent/position.service';

export class App {
  async start(): Promise<void> {
    console.log('🚀 Base Sniper Bot Starting...');
    await telegramService.init();
    console.log('📱 Telegram command interface enabled');

    // Initialize wallet monitoring service
    const walletCount = walletMonitoringService.getMonitoredWalletCount();
    if (walletCount > 0) {
      console.log(`💳 Wallet monitoring ready for ${walletCount} addresses`);
    } else {
      console.log('💳 No wallet addresses configured for monitoring');
    }

    // Position risk manager loop (TP/SL/time-based close checks)
    setInterval(async () => {
      try {
        await agentPositionService.evaluateRiskAndClose();
      } catch (error) {
        console.error('Agent position manager loop error:', error);
      }
    }, 60_000);
  }
}
