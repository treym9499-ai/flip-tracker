/*
 * Flip Tracker — BONUS CODE config: official channels + parsing rules (edit here only).
 *
 * Channels: ONLY Stake.us official public Telegram channels, verified 2026-10-17 against
 * Stake.us's own Help Center article "Trusted channels and how to check their legitimacy"
 * (https://help.stake.us/en/articles/8570836), which lists exactly:
 *   https://t.me/StakeSocial, https://t.me/StakeUSDailyDrops (and twitter.com/stakeusa).
 * The "Bonus drops and how to redeem them" article (help.stake.us/en/articles/6790398)
 * also points users to the official Daily Drops Telegram channel.
 * Do NOT add fan / "leak" / reposter channels.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlipCodesConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    CHANNELS: [
      { id: 'StakeUSDailyDrops', name: 'Stake.US Daily Drops', source: 'https://help.stake.us/en/articles/8570836' },
      { id: 'StakeSocial', name: 'Stake.us (StakeSocial)', source: 'https://help.stake.us/en/articles/8570836' }
    ],
    PREVIEW_URL: (id) => 'https://t.me/s/' + encodeURIComponent(id),

    /* refresh / rate limiting */
    ALARM_NAME: 'flip-tracker-codes-refresh',
    REFRESH_MINUTES: 12 * 60,       // chrome.alarms schedule: every 12 hours (runs without the overlay open)
    WINDOW_MS: 12 * 60 * 60 * 1000, // show codes posted within the last 12 h of the scan...
    FALLBACK_COUNT: 5,              // ...or, if none, the newest N items from the scan (labelled as older)
    MANUAL_GAP_MS: 10 * 60 * 1000,  // "Refresh now" at most once per 10 minutes
    BACKOFF_MS: 30 * 60 * 1000,     // after HTTP 429/5xx
    TIMEOUT_MS: 10000,
    MAX_ITEMS: 30,

    /* parsing rules */
    // Keyword followed by a code token, e.g. "Code: stakeusabc123", "bonus code ABC123", "drop code - XYZ99".
    KEYWORD_CODE: /(?:bonus\s+drop\s+code|bonus\s+code|drop\s+code|promo\s+code|code)\s*(?:is\s*)?[:：\-–—]?\s*([A-Za-z0-9][A-Za-z0-9_-]{4,40})/gi,
    // Stake.us drop codes seen in the official channel start with "stakeus".
    STAKE_TOKEN: /\bstakeus[a-z0-9]{6,30}\b/gi,
    // Uppercase alphanumeric tokens near a keyword (within NEAR_CHARS after it).
    NEAR_KEYWORD: /\b(?:bonus|drop|promo|code)\b/gi,
    UPPER_TOKEN: /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{5,24}\b|\b[A-Z]{6,24}\b/g,
    NEAR_CHARS: 80,
    // Words that are never codes.
    STOPWORDS: ['without', 'spaces', 'below', 'above', 'value', 'drop', 'drops', 'alert', 'bonus', 'limit', 'total',
      'requirements', 'redeem', 'settings', 'offers', 'stake', 'stakeus', 'telegram', 'channel', 'claim', 'codes',
      'expired', 'here', 'there', 'please', 'monthly', 'weekly', 'daily', 'played', 'wager', 'sweeps', 'coins', 'gold'],
    // Post says the code is in its image/video (can't be read from text).
    CODE_IN_MEDIA: /code\s+is\s+(?:without\s+spaces\s+)?(?:above|in\s+the\s+(?:image|video|picture))/i,
    // Is the post about a code at all?
    POST_HINT: /\b(?:code|bonus\s*drop|drop)\b/i,
    // Useful details for the snippet.
    DETAILS: { value: /Value\s*:\s*([^\n]{1,40})/i, requirements: /Requirements?\s*:\s*([^\n]{1,90})/i, limit: /Total\s+Drop\s+Limit\s*:\s*([^\n]{1,40})/i }
  };
});
