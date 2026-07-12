/**
 * validation.js
 * Small, dependency-free sanitizers. Nothing here talks to the DOM or network —
 * just pure functions used by ui.js and api.js.
 */
window.KanhaValidate = (function () {

  // Strip characters that have no business in a name/notes field and cap length.
  function sanitizeText(input, maxLen) {
    if (typeof input !== "string") return "";
    const cleaned = input
      .replace(/[<>]/g, "")     // no stray HTML-looking brackets
      .replace(/\s+/g, " ")     // collapse whitespace
      .trim();
    return cleaned.slice(0, maxLen || 60);
  }

  // Loose UAE-friendly phone check. Optional field — empty string is valid (not required).
  function isValidPhone(input) {
    if (!input) return true;
    const digitsOnly = input.replace(/[\s-]/g, "");
    return /^(\+?971|0)?5\d{8}$/.test(digitsOnly);
  }

  // WhatsApp / mobile browsers can choke on extremely long deep-link URLs.
  // Keep the encoded message under a safe threshold; if it's too long,
  // fall back to a shorter summary format.
  const SAFE_URL_CHAR_LIMIT = 1800;

  function isMessageTooLong(encodedMessage) {
    return encodedMessage.length > SAFE_URL_CHAR_LIMIT;
  }

  return {
    sanitizeText,
    isValidPhone,
    isMessageTooLong,
    SAFE_URL_CHAR_LIMIT
  };
})();
