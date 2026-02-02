import TelegramBot from 'node-telegram-bot-api';
import catchAsync from '../utils/catchAsync.js';
import * as chatbotService from '../services/chatbot.service.js';
import logger from '../config/logger.js';

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Strip HTML tags and normalize whitespace for plain-text Telegram messages
 * @param {string} html - HTML string
 * @param {number} maxLength - Max chars to return
 * @returns {string}
 */
function htmlToTelegramText(html, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH - 200) {
  if (!html || typeof html !== 'string') return '';
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * Build Telegram reply text from chatbot response
 * @param {Object} response - chatbotService.processMessage result
 * @returns {string}
 */
function buildTelegramReply(response) {
  const parts = [];
  if (response.message) parts.push(response.message);
  if (response.suggestions && response.suggestions.length) {
    parts.push('\n\nTry: ' + response.suggestions.slice(0, 5).join(', '));
  }
  if (response.html && response.type === 'success') {
    const plain = htmlToTelegramText(response.html);
    if (plain) parts.push('\n\n' + plain);
  }
  if (response.type === 'error' && response.message) {
    return response.message;
  }
  const text = parts.join('').trim();
  return text.length > TELEGRAM_MAX_MESSAGE_LENGTH
    ? text.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 20) + '…'
    : text || 'No response.';
}

/**
 * Handle incoming Telegram webhook (POST from Telegram servers)
 * Receives Update, runs chatbot, sends reply via Bot API
 */
export const handleTelegramWebhook = catchAsync(async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn('TELEGRAM_BOT_TOKEN not set; telegram webhook ignored');
    return res.sendStatus(200);
  }

  const update = req.body;
  if (!update) {
    return res.sendStatus(200);
  }

  const message = update.message || update.edited_message;
  const chatId = message?.chat?.id;
  const text = (message?.text || '').trim();

  if (!chatId) {
    return res.sendStatus(200);
  }

  const bot = new TelegramBot(token, { polling: false });

  if (!text) {
    await bot.sendMessage(
      chatId,
      'Send me a message (e.g. "show me top 5 products" or "help") and I\'ll reply with analytics.'
    );
    return res.sendStatus(200);
  }

  try {
    const response = await chatbotService.processMessage(text);
    const replyText = buildTelegramReply(response);
    await bot.sendMessage(chatId, replyText, { parse_mode: undefined });
  } catch (err) {
    logger.error('Telegram webhook chatbot error:', err);
    await bot.sendMessage(chatId, `Sorry, something went wrong: ${err.message}`).catch(() => {});
  }

  res.sendStatus(200);
});

/**
 * Set Telegram webhook URL using API_URL from .env (live backend URL).
 * Optional override: ?url=... or body.url
 */
export const setTelegramWebhook = catchAsync(async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(503).json({
      success: false,
      message: 'TELEGRAM_BOT_TOKEN is not configured',
    });
  }

  const baseUrl = (req.query.url || req.body?.url || process.env.API_URL || '')
    .toString()
    .replace(/\/+$/, '');
  if (!baseUrl) {
    return res.status(400).json({
      success: false,
      message: 'Missing API_URL in .env or provide ?url=https://your-public-domain.com',
    });
  }

  const webhookUrl = `${baseUrl}/v1/chatbot/telegram/webhook`;
  const bot = new TelegramBot(token, { polling: false });
  await bot.setWebHook(webhookUrl);

  return res.status(200).json({
    success: true,
    message: 'Telegram webhook set',
    webhookUrl,
  });
});
