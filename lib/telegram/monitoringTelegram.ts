import BigNumber from 'bignumber.js';
import { tokenMonitoringService } from '../services/monitoring/tokenMonitoring.service';
import { getNonWETHToken } from '../contracts/pairAnalyzer';
import { IPairInfo, TFactorySelected } from '../interface/token.interface';
import { config } from '../utils/config';
import { telegramBot } from './telegram';
import { factoryList } from '../utils/utils';
import { stateService } from '../services/state.service';
import { checkUserTokenInfo } from '../services/info.service';
import { ethers } from 'ethers';
import { uniswapTradingService } from '../services/uniswapTrading.service';
import { decisionEngineService } from '../services/agent/decisionEngine.service';
import { agentPolicyService } from '../services/agent/policy.service';
import { agentPositionService } from '../services/agent/position.service';

// Send new pair alert
export async function sendPairAlert(pairInfo: IPairInfo, exchange: string): Promise<void> {
  const nonWETHToken = getNonWETHToken(pairInfo);
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').replace('Z', ' UTC');

  // Determine which side is non-WETH for flag placement
  const lowerWeth = config.WETH_ADDRESS.toLowerCase();
  const nonWethIsToken0 = pairInfo.token0.address.toLowerCase() !== lowerWeth;
  const nonWethVerified = nonWethIsToken0 ? pairInfo.token0Verified : pairInfo.token1Verified;
  const verifiedEmoji = nonWethVerified === undefined ? '❔' : nonWethVerified ? '✅' : '❌';

  const message =
    `🎯 *NEW HIGH-LIQUIDITY TOKEN DETECTED*\n\n` +
    `🕒 Time: ${timestamp}\n` +
    `🏪 Exchange: *${exchange}*\n` +
    `🪙 Token: *${nonWETHToken.symbol}* (${nonWETHToken.name}) ${verifiedEmoji}\n` +
    `📍 Address: \`${nonWETHToken.address}\`\n` +
    `💧 Liquidity: *${pairInfo.liquidityETH.toFixed(2)} ETH*\n` +
    `📊 Total Supply: *${new BigNumber(nonWETHToken.totalSupply)
      .dividedBy(new BigNumber(10).pow(nonWETHToken.decimals))
      .toFormat()}*\n` +
    `🔗 Pair: \`${pairInfo.pairAddress}\`\n` +
    `🔗 DexScreener URL: [Open Link](http://dexscreener.com/base/${nonWETHToken.address})`;

  try {
    await telegramBot.sendMessage(config.TELEGRAM_CHAT_ID, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch (error) {
    console.error('Error sending Telegram message:', error);
  }
  console.log(
    `🚨 ALERT: New token ${
      nonWETHToken.symbol
    } with ${pairInfo.liquidityETH.toFixed(2)} ETH liquidity`
  );

  // Optional autonomous follow-up (paper/live mode controlled by policy)
  await decisionEngineService.evaluateAndAct({ pairInfo, exchange });
}

export function commandHandlers(): void {
  telegramBot.onText(/^\/start$/, async msg => {
    const chatId = msg.chat.id;
    if (tokenMonitoringService.status()) {
      await telegramBot.sendMessage(chatId, '⚠️ Monitoring is already running');
      return;
    }
    await tokenMonitoringService.start();
    const factories = tokenMonitoringService.getSelectedFactories();
    if (!factories.length) {
      await telegramBot.sendMessage(
        chatId,
        '🟢 Monitoring started, but no factories are currently selected. Use /addfactory <name>.'
      );
    } else {
      await telegramBot.sendMessage(
        chatId,
        `🟢 Monitoring started\n🏭 Listening to ${factories.length} factory(ies): ${factories.join(', ')}`
      );
    }
  });

  telegramBot.onText(/^\/stop$/, async msg => {
    const chatId = msg.chat.id;
    if (!tokenMonitoringService.status()) {
      await telegramBot.sendMessage(chatId, '⚠️ Monitoring is not running');
      return;
    }
    tokenMonitoringService.stop();
    await telegramBot.sendMessage(chatId, '🛑 Monitoring stopped');
  });

  telegramBot.onText(/^\/status$/, async msg => {
    const chatId = msg.chat.id;
    const status = tokenMonitoringService.status() ? 'Running 🟢' : 'Stopped 🛑';
    await telegramBot.sendMessage(chatId, `Monitoring Status: ${status}`);
  });

  telegramBot.onText(/^\/automode (on|off)$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const mode = (match?.[1] || '').toLowerCase();
    const updated = agentPolicyService.setPolicy({ enabled: mode === 'on' });
    await telegramBot.sendMessage(
      chatId,
      `🤖 Auto mode is now *${updated.enabled ? 'ON' : 'OFF'}*\nExecution mode: *${updated.executionMode}*`,
      { parse_mode: 'Markdown' }
    );
  });

  telegramBot.onText(/^\/executionmode (paper|live)$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const executionMode = (match?.[1] || 'paper').toLowerCase() as 'paper' | 'live';
    const updated = agentPolicyService.setPolicy({ executionMode });
    await telegramBot.sendMessage(
      chatId,
      `⚙️ Execution mode updated to *${updated.executionMode}*`,
      { parse_mode: 'Markdown' }
    );
  });

  telegramBot.onText(/^\/agentstatus$/, async msg => {
    const chatId = msg.chat.id;
    const policy = agentPolicyService.getPolicy();
    const openCount = agentPositionService.getOpenPositions().length;
    const text =
      `🤖 *Agent Status*\n` +
      `enabled: *${policy.enabled}*\n` +
      `executionMode: *${policy.executionMode}*\n` +
      `minScore: *${policy.minScore}*\n` +
      `buyEth: *${policy.defaultBuyEth}*\n` +
      `liquidityRange: *${policy.minLiquidityEth} - ${policy.maxLiquidityEth} ETH*\n` +
      `cooldown: *${policy.cooldownMinutes} min*\n` +
      `tp/sl: *${policy.takeProfitPercent}% / ${policy.stopLossPercent}%*\n` +
      `maxHolding: *${policy.maxHoldingMinutes} min*\n` +
      `openPositions: *${openCount}/${policy.maxConcurrentPositions}*`;
    await telegramBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  telegramBot.onText(/^\/positions$/, async msg => {
    const chatId = msg.chat.id;
    const open = agentPositionService.getOpenPositions();
    if (!open.length) {
      await telegramBot.sendMessage(chatId, '📭 No open positions');
      return;
    }
    const lines = open.map(
      (p, i) => `${i + 1}. *${p.symbol}*\n   token: \`${p.tokenAddress}\`\n   opened: ${p.openedAt}`
    );
    await telegramBot.sendMessage(chatId, `📌 *Open Positions*\n\n${lines.join('\n\n')}`, {
      parse_mode: 'Markdown',
    });
  });

  telegramBot.onText(/^\/close (.+)$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const tokenAddress = (match?.[1] || '').trim();
    if (!ethers.isAddress(tokenAddress)) {
      await telegramBot.sendMessage(
        chatId,
        '⚠️ Invalid token address. Usage: /close <token_address>'
      );
      return;
    }
    try {
      const tx = await agentPositionService.closePosition(
        tokenAddress,
        'Manual close via Telegram'
      );
      await telegramBot.sendMessage(chatId, `✅ Position closed\nTx: ${tx}`);
    } catch (error) {
      await telegramBot.sendMessage(chatId, `❌ Close failed: ${error}`);
    }
  });

  telegramBot.onText(/^\/factorylist$/, async msg => {
    const chatId = msg.chat.id;
    if (factoryList.length === 0) {
      await telegramBot.sendMessage(chatId, '⚠️ Factory is Empty');
      return;
    }
    await telegramBot.sendMessage(chatId, `✅ Factory list: *${factoryList.join(', ')}*`, {
      parse_mode: 'Markdown',
    });
  });

  telegramBot.onText(/^\/factoryselected$/, async msg => {
    const chatId = msg.chat.id;
    const service = await stateService.getConfig();
    const factorySelected = service.factorySelected;
    if (!factorySelected || factorySelected.length === 0) {
      await telegramBot.sendMessage(chatId, '⚠️ No factories selected');
      return;
    }

    await telegramBot.sendMessage(chatId, `✅ Factory selected: *${factorySelected.join(', ')}*`, {
      parse_mode: 'Markdown',
    });
  });

  telegramBot.onText(/^\/addfactory (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!match || !match[1]) {
      await telegramBot.sendMessage(
        chatId,
        '⚠️ Please provide factory names. Usage: /addfactory factory1'
      );
      return;
    }

    const factoryName = match[1];
    const isFactoryValid = factoryList.includes(factoryName);

    if (!isFactoryValid) {
      await telegramBot.sendMessage(
        chatId,
        `⚠️ Invalid factory: ${factoryName}\n 🗒️ Available: ${factoryList.join(', ')}`
      );
      return;
    }

    const service = await stateService.getConfig();
    if (service.factorySelected?.includes(factoryName as TFactorySelected)) {
      await telegramBot.sendMessage(chatId, `⚠️ Factory *${factoryName}* is already selected`, {
        parse_mode: 'Markdown',
      });
      return;
    }

    const currentFactories = service.factorySelected || [];
    currentFactories.push(factoryName as TFactorySelected);
    await stateService.set('factorySelected', currentFactories);

    // Reload monitoring listeners with the updated selection
    await tokenMonitoringService.reloadFactories();

    await telegramBot.sendMessage(
      chatId,
      `✅ Factory selection updated: ${currentFactories.join(', ')}`
    );
  });

  telegramBot.onText(/^\/removefactory (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!match || !match[1]) {
      await telegramBot.sendMessage(
        chatId,
        '⚠️ Please provide factory name. Usage: /removefactory factory1'
      );
      return;
    }

    const factoryName = match[1];
    const service = await stateService.getConfig();
    const currentFactories = service.factorySelected || [];

    if (!currentFactories.includes(factoryName as TFactorySelected)) {
      await telegramBot.sendMessage(chatId, `⚠️ Factory *${factoryName}* is not selected`, {
        parse_mode: 'Markdown',
      });
      return;
    }

    const updatedFactories = currentFactories.filter(f => f !== factoryName);
    await stateService.set('factorySelected', updatedFactories);

    // Reload monitoring listeners to reflect removal
    await tokenMonitoringService.reloadFactories();

    await telegramBot.sendMessage(
      chatId,
      `✅ Factory removed. Current selection: ${updatedFactories.length > 0 ? updatedFactories.join(', ') : 'None'}`
    );
  });

  // Handle /swap command
  telegramBot.onText(/\/buy (.+)/, async (msg, match) => {
    try {
      const chatId = msg.chat.id;

      // Check if the chat ID matches the configured chat ID
      if (chatId.toString() !== config.TELEGRAM_CHAT_ID) {
        await telegramBot.sendMessage(chatId, '⛔ Unauthorized access');
        return;
      }

      // Parse command arguments
      const args = (match ?? '')[1].split(' ');

      if (args.length < 2) {
        await telegramBot.sendMessage(
          chatId,
          '⚠️ Invalid format. Use: /buy <token_address> <eth_amount> [router_index] [slippage]\n\n' +
            'Example: /buy 0x1234...abcd 0.1 0 5\n' +
            'Router index: 0 for Uniswap V2, 1 for Aerodrome\n' +
            'Slippage: percentage (default 5%)'
        );
        return;
      }

      const tokenAddress = args[0];
      const ethAmount = parseFloat(args[1]);
      const routerIndex = args.length > 2 ? parseInt(args[2]) : 0;
      const slippage = args.length > 3 ? parseInt(args[3]) : 5;

      // Validate inputs
      if (isNaN(ethAmount) || ethAmount <= 0) {
        await telegramBot.sendMessage(chatId, '⚠️ Invalid ETH amount. Must be a positive number.');
        return;
      }

      if (![0, 1].includes(routerIndex)) {
        await telegramBot.sendMessage(
          chatId,
          '⚠️ Invalid router index. Use 0 for Uniswap V2 or 1 for Aerodrome.'
        );
        return;
      }

      if (isNaN(slippage) || slippage < 1 || slippage > 100) {
        await telegramBot.sendMessage(chatId, '⚠️ Invalid slippage. Must be between 1 and 100.');
        return;
      }

      // Check if wallet private key is configured
      if (!config.WALLET_PRIVATE_KEY) {
        await telegramBot.sendMessage(
          chatId,
          '⚠️ No wallet private key configured. Cannot execute swap.'
        );
        return;
      }

      // Validate token address
      if (!ethers.isAddress(tokenAddress)) {
        await telegramBot.sendMessage(chatId, '⚠️ Invalid token address format.');
        return;
      }

      // Send processing message
      await telegramBot.sendMessage(
        chatId,
        `🔄 Processing swap of ${ethAmount} ETH for token ${tokenAddress}`
      );

      // Execute the swap via Uniswap Trading API
      const buyResult = await uniswapTradingService.buyTokenWithUniswap(tokenAddress, ethAmount);

      await telegramBot.sendMessage(
        chatId,
        `✅ *Swap transaction submitted! Tx Hash*: \`${buyResult.txHash}\n\n\`` +
          `📊 *Purchased* : ${ethers.formatUnits(
            buyResult.tokenInfo.balance.toString(),
            buyResult.tokenInfo.decimals
          )} *${buyResult.tokenInfo.symbol}*`,
        {
          parse_mode: 'Markdown',
        }
      );
    } catch (error) {
      console.error('Error handling swap command:', error);
      try {
        await telegramBot.sendMessage(
          msg.chat.id,
          `❌ An error occurred while processing your swap request.\n ${error}`
        );
      } catch (telegramError) {
        console.error('Error sending Telegram error message:', telegramError);
      }
    }
  });

  // Handle /sell command
  telegramBot.onText(/\/sell (.+)/, async (msg, match) => {
    try {
      const chatId = msg.chat.id;

      // Check if the chat ID matches the configured chat ID
      if (chatId.toString() !== config.TELEGRAM_CHAT_ID) {
        await telegramBot.sendMessage(chatId, '⛔ Unauthorized access');
        return;
      }

      // Parse command arguments
      const args = (match ?? '')[1].split(' ');

      if (args.length < 2) {
        await telegramBot.sendMessage(
          chatId,
          '⚠️ Invalid format. Use: /sell <token_address> <token_amount> [router_index] [slippage]\n\n' +
            'Example: /sell 0x1234...abcd 100 0 5\n' +
            'Router index: 0 for Uniswap V2, 1 for Aerodrome\n' +
            'Slippage: percentage (default 5%)\n\n' +
            "Use 'max' as token_amount to sell all tokens"
        );
        return;
      }

      const tokenAddress = args[0];
      const tokenAmount = args[1];
      const routerIndex = args.length > 2 ? parseInt(args[2]) : 0;
      const slippage = args.length > 3 ? parseInt(args[3]) : 5;

      // Validate inputs
      if (tokenAmount.toLowerCase() !== 'max') {
        const amount = parseFloat(tokenAmount);
        if (isNaN(amount) || amount <= 0) {
          await telegramBot.sendMessage(
            chatId,
            "⚠️ Invalid token amount. Must be a positive number or 'max'."
          );
          return;
        }
      }

      if (![0, 1].includes(routerIndex)) {
        await telegramBot.sendMessage(
          chatId,
          '⚠️ Invalid router index. Use 0 for Uniswap V2 or 1 for Aerodrome.'
        );
        return;
      }

      if (isNaN(slippage) || slippage < 1 || slippage > 100) {
        await telegramBot.sendMessage(chatId, '⚠️ Invalid slippage. Must be between 1 and 100.');
        return;
      }

      // Check if wallet private key is configured
      if (!config.WALLET_PRIVATE_KEY) {
        await telegramBot.sendMessage(
          chatId,
          '⚠️ No wallet private key configured. Cannot execute swap.'
        );
        return;
      }

      // Validate token address
      if (!ethers.isAddress(tokenAddress)) {
        await telegramBot.sendMessage(chatId, '⚠️ Invalid token address format.');
        return;
      }

      // Send processing message
      await telegramBot.sendMessage(
        chatId,
        `🔄 Processing swap to sell ${
          tokenAmount === 'max' ? 'all' : tokenAmount
        } tokens of ${tokenAddress} for ETH...`
      );

      // Execute the swap via Uniswap Trading API
      const sellResult = await uniswapTradingService.sellTokenWithUniswap(tokenAddress, tokenAmount);

      await telegramBot.sendMessage(
        chatId,
        `✅ *Sell transaction submitted! Tx Hash*: \`${sellResult.txHash}\`\n\n` +
          `💰 *Remaining* : ${ethers.formatUnits(
            sellResult.tokenInfo.balance.toString(),
            sellResult.tokenInfo.decimals
          )} *${sellResult.tokenInfo.symbol}*`,
        {
          parse_mode: 'Markdown',
        }
      );
    } catch (error) {
      console.error('Error handling sell command:', error);
      try {
        await telegramBot.sendMessage(
          msg.chat.id,
          `❌ An error occurred while processing your sell request.\n ${error}`
        );
      } catch (telegramError) {
        console.error('Error sending Telegram error message:', telegramError);
      }
    }
  });

  telegramBot.onText(/\/tokenbalance (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;

    // Check if the chat ID matches the configured chat ID
    if (chatId.toString() !== config.TELEGRAM_CHAT_ID) {
      await telegramBot.sendMessage(chatId, '⛔ Unauthorized access');
      return;
    }

    const args = (match ?? '')[1].split(' ');
    const tokenAddress = args[0];

    try {
      const balance = await checkUserTokenInfo(tokenAddress);
      await telegramBot.sendMessage(
        chatId,
        `\n📊 *Token Balance*: ${ethers.formatUnits(
          balance.balance.toString(),
          balance.decimals
        )} *${balance.symbol}*`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      await telegramBot.sendMessage(chatId, `Error checking token balance: ${error}`);
    }
  });
}
