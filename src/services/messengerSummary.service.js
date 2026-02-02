/**
 * Messenger summary service: same FAQ/ask flow as website, but returns
 * text-only summarized response for Telegram, WhatsApp, etc.
 * Does not change existing /v1/faq/ask API or response structure.
 */

import faqService from './faq.service.js';

const TELEGRAM_MAX_LENGTH = 4096;
const SUMMARY_MAX_LENGTH = 3800;

/**
 * Strip HTML to plain text and optionally truncate
 * @param {string} html
 * @param {number} maxLen
 * @returns {string}
 */
function stripHtml(html, maxLen = SUMMARY_MAX_LENGTH) {
  if (!html || typeof html !== 'string') return '';
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > maxLen) text = text.slice(0, maxLen) + '…';
  return text;
}

/**
 * Remove style/script and other non-content so summary never includes CSS/code
 * @param {string} html
 * @returns {string}
 */
function removeNonContent(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+\s+class="[^"]*response[^"]*"[^>]*>/gi, ' '); // avoid inline style attrs leaking
}

/**
 * Extract summary paragraph and KPIs from AI-tool HTML for a short text summary.
 * Strips <style> and <script> so Telegram never sees CSS/code.
 * @param {string} html - AI tool response HTML
 * @returns {string}
 */
function summarizeAiToolHtml(html) {
  if (!html || typeof html !== 'string') return stripHtml(html, 800);

  const cleanHtml = removeNonContent(html);
  const parts = [];

  // Extract <p class="summary">...</p> (human-readable summary)
  const summaryMatch = cleanHtml.match(/<p\s+class="summary"[^>]*>([\s\S]*?)<\/p>/i);
  if (summaryMatch) {
    parts.push(stripHtml(summaryMatch[1], 600).trim());
  }

  // Extract kpi-item: kpi-label + kpi-value as "Label: Value" (first 8)
  const kpiLabelRegex = /<div\s+class="kpi-label"[^>]*>([\s\S]*?)<\/div>/gi;
  const kpiValueRegex = /<div\s+class="kpi-value"[^>]*>([\s\S]*?)<\/div>/gi;
  const labels = [...cleanHtml.matchAll(kpiLabelRegex)].map((m) => stripHtml(m[1], 50).trim()).filter(Boolean);
  const values = [...cleanHtml.matchAll(kpiValueRegex)].map((m) => stripHtml(m[1], 80).trim()).filter(Boolean);
  if (labels.length > 0 && values.length > 0) {
    const kpiLines = labels.slice(0, 8).map((l, i) => (values[i] != null ? `${l}: ${values[i]}` : l));
    if (kpiLines.length) parts.push(kpiLines.join(' | '));
  }

  // If we have an h3 title (e.g. "Brand Performance"), use it as header
  const h3Match = cleanHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  if (h3Match && parts.length > 0) {
    const title = stripHtml(h3Match[1], 80).trim();
    if (title) parts.unshift(title);
  }

  const out = parts.filter(Boolean).join('\n\n');
  // Fallback: strip tags from content-only HTML (no style/script left)
  return out || stripHtml(cleanHtml, 800);
}

/**
 * Convert FAQ ask result to text-only summary for messengers
 * @param {Object} result - faqService.askQuestion result
 * @returns {string}
 */
function summarizeForMessenger(result) {
  if (!result) return 'No response.';

  // Plain FAQ / conversation response (already text)
  if (result.type === 'faq' || result.type === 'conversation_service') {
    const text = (result.response || '').trim();
    if (result.suggestions && result.suggestions.length) {
      return text + '\n\nTry: ' + result.suggestions.slice(0, 5).join(', ');
    }
    return text || 'No response.';
  }

  // AI tool: response is HTML
  if (result.type === 'ai_tool' && result.response) {
    const summary = summarizeAiToolHtml(result.response);
    const withIntent = result.intent?.description
      ? `${result.intent.description}\n\n${summary}`
      : summary;
    return withIntent.length > SUMMARY_MAX_LENGTH
      ? withIntent.slice(0, SUMMARY_MAX_LENGTH - 20) + '…'
      : withIntent;
  }

  // Fallback: strip any HTML
  if (result.response) return stripHtml(String(result.response), SUMMARY_MAX_LENGTH);
  return 'No response.';
}

/**
 * Ask question using same FAQ/ask flow as website, return text summary only.
 * For use by Telegram webhook, WhatsApp, etc.
 * @param {string} question
 * @returns {Promise<{ summary: string }>}
 */
export async function getSummary(question) {
  const result = await faqService.askQuestion(question);
  const summary = summarizeForMessenger(result);
  return {
    summary: summary.length > TELEGRAM_MAX_LENGTH ? summary.slice(0, TELEGRAM_MAX_LENGTH - 20) + '…' : summary,
  };
}
