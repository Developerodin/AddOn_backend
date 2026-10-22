/**
 * Text of the latest user turn. Accepts AI SDK UI parts and plain `content`.
 * @param {unknown} messages
 * @returns {string}
 */
export default function latestUserMessage(messages) {
  if (!Array.isArray(messages)) return '';
  const message = [...messages].reverse().find((item) => item && item.role === 'user');
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.parts)) return '';
  return message.parts
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}
