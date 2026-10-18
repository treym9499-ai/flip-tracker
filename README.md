# Flip Tracker (Chrome extension) — v1.0.1

A **read-only** tracker for the Stake.us Originals game **Flip** (`https://stake.us/casino/games/flip`).
It records your own flip results and shows stats, a profit chart, sessions, and CSV/JSON export.

> **Each flip is an independent 50/50 (provably fair). Past results don't predict future flips.**
> This note is always shown in the popup and the dashboard. There are no prediction, "next outcome",
> hot/cold, or pattern features, and none will be added.

## What's new in 1.0.1
- **Capture fixed on the real stake.us.** In 1.0.0 the page observer was injected as a `<script>` tag, which Stake's Content-Security-Policy can block. It also only forwarded responses whose path contained `/_api/` and whose text mentioned "flip". The observer is now a manifest content script with `"world": "MAIN"`, `"run_at": "document_start"`, `"all_frames": true` (Chrome 111+). Chrome runs it before Stake's code, in every frame, and the page CSP can't block it. Capture no longer depends on the URL path.
- **Phantom flips fixed.** Only **your own** bets are recorded:
  - Bets inside lists, or under public or history feed keys (`houseBets`, `highrollerBets`, `allBets`, `recentBets`, `myBets`…), are ignored.
  - Non-mutation queries are ignored.
  - WebSocket messages (the public live-bet feed) are ignored.
  - Bets without a bet id are ignored.
  - Retries and refetches of the same game are de-duplicated by game id + flip index.
  - The DOM fallback stays OFF by default. When on, it only counts entries newly added to your own result strip, never bet feeds or tables.
  - On update, records without a real bet id (left over from 1.0.0) are removed.
  - **Reset stats** in the Dashboard clears any bad data.
- **Games, not flips, are the headline.** A **game** runs from pressing **Play** until you **lose** or **Cash out**. The headline numbers are *Games played*, *Games won* (cashed out) and *Games lost*, and P/L is per game. Every flip inside a game is still recorded: pick, Heads/Tails result, flip #, game id, and time.
- **Last 25 flips:** a compact `H,T,H,…` sequence, oldest to newest, in the overlay, popup and dashboard. It is a record only; nothing is predicted.
- **Debug mode now records shapes independently.**
  - It runs whether or not **Begin Tracker** is pressed, and it doesn't need the word "flip".
  - It records sanitized shapes (keys only; values redacted except game fields) for any game- or bet-looking JSON response or message on stake.us.
  - Each shape includes the URL path (no query) and the transport.
  - Shapes are de-duplicated and capped at 200.
  - A status line ("Interceptor active in N frames · M responses seen · K flip-like") in the Dashboard and the overlay (when debug is on) shows whether the observer is running.
- **Compact overlay:**
  - Docked **top-right** (12 px), about 272 px wide.
  - The body scrolls (max height `min(55vh, 420px)`) with a slim neon scrollbar. Scrolling inside it doesn't scroll the page behind.
  - At a glance: Begin/Stop, games played, session P/L and the last 25 flips. Detailed stats and codes are further down.
  - Collapsed, it becomes a small pill in the top-right.
  - Saved positions are reset to top-right by this update. Drag still works, and there's a **↗ Reset position** button (also in the popup).

## Quick start
1. Click the toolbar icon. A **"Made by TDM"** splash shows for 5 seconds every time the popup opens.
2. Optional: tick **Show on-page overlay on stake.us**. This setting is saved.
3. Press **▶ Begin Tracker**, in the popup or in the overlay. **Nothing is recorded until you do.**
   While tracking, the button reads **■ Stop Tracker** and a green indicator is lit.

## On-page overlay (stake.us)
- A black box with neon-green (#39FF14) text and a pulsing green glow on its border. It's built in Shadow DOM so it doesn't mix with Stake's page.
- It sits on top of the page (z-index 2147483647). Only the box itself catches clicks, so the rest of the page stays clickable.
- **Draggable** by its header and **collapsible** with the –/+ button. Its position is remembered.
- The first time it appears on each page load, it shows **"Made by TDM"** for 5 seconds before the normal content.
- Contents:
  - **Begin/Stop Tracker** button.
  - **Session P/L** since you pressed Begin Tracker, per currency (SC and GC):
    - *Profit*: the sum of net from winning rounds.
    - *Losses*: the sum of net from losing rounds.
    - *Net*.
  - **Flip stats** for the session: flips (W/L), heads/tails result split, current streak, longest win and loss streaks.
  - The independence note.
  - **Recently posted codes** (see below).
- **Loss warning:** when the tracker session's **SC net reaches −10.00** (SC counted as $), an on-page modal appears:
  "**WARNING!** Maybe you should change seeds or try a different game for now… you've lost $10 so far."
  - "WARNING!" is red; the rest is neon green.
  - **Close** dismisses it.
  - It shows once per crossing per session. If net climbs back above −10 and drops again, it shows again.
  - The threshold can be changed in Dashboard → Settings (default 10); the $ amount in the message follows it.

## Recently posted codes
Flip Tracker reads the public, no-login Telegram web previews (`https://t.me/s/<channel>`) of **Stake.us's official channels only**:

| Channel | Verified how |
|---|---|
| [t.me/StakeUSDailyDrops](https://t.me/StakeUSDailyDrops) | Listed in Stake.us Help Center, "Trusted channels and how to check their legitimacy" ([help.stake.us/en/articles/8570836](https://help.stake.us/en/articles/8570836-trusted-channels-and-how-to-check-their-legitimacy)). Also referenced by "Bonus drops and how to redeem them" ([6790398](https://help.stake.us/en/articles/6790398-bonus-drops-and-how-to-redeem-them)). Its posts are "Bonus Drop Alert" codes. |
| [t.me/StakeSocial](https://t.me/StakeSocial) | Listed in the same Help Center article. It's the main Stake.us announcement channel and rarely posts codes. |

No fan, "leak", or reposter channels are used. The list lives in `extension/lib/codes-config.js`.

- **Schedule:** the background worker uses `chrome.alarms` to refresh **every 12 hours**, whether or not the overlay is open. It also fetches once on install or first run if the cache is empty.
- **Rate limits:** **Refresh now** works at most once every 10 minutes. After an HTTP 429 or 5xx it backs off for 30 minutes. It makes one request per channel, one after another.
- **Each refresh replaces the list.** Only codes from the new scan are shown:
  - codes **posted in the last 12 hours**, or
  - if none, the **5 newest** codes from the scan, clearly labelled as older.
  - If a refresh fails completely, the previous list stays up and the error is shown.
- **Each item shows:** the code, the channel, the post age, value and requirements when the post has them, a short snippet, a link to the original post, and a **Copy** button that says "Copied!" once done.
  - When a post's code is only in its image or video, the item says so and links to the post.
- **Mark a code** as *Used* or *Didn't work* to hide it locally. *Unhide* brings marked codes back.
- The panel header reads "Last refreshed X ago · next refresh in Y".
- **Honesty:** these are **recently posted** codes. A code may already be expired or fully claimed, and there's no way to check without redeeming it. Flip Tracker **never redeems codes and never touches your Stake account.** To redeem, go to Stake.us → Settings → Offers → Redeem Bonus Drop yourself.
- **Parsing rules** (keyword + code token, `stakeus…` tokens, uppercase alphanumeric tokens near "code/bonus/drop", stop-words, code-in-media detection) are all in `extension/lib/codes-config.js`. The parser is `extension/lib/telegram-codes.js`.

## What it never does
- It never places bets, clicks buttons, types into the page, or automates play.
- It never reads or stores cookies, auth tokens, request/response headers, your user name, or your user ID.
- It never sends your data anywhere. Everything stays in `chrome.storage.local` in your browser. It loads no remote code and uses no CDN.
- Its only outbound requests are the read-only, cookie-less fetches of the two official `t.me/s/` channel previews.
- Permissions: `storage`, `alarms`, and host access to `https://t.me/s/*` only. The content script runs on `stake.us`.

## Install in Chrome
1. Unzip `flip-tracker-chrome.zip` into a folder you'll keep, for example `Documents/flip-tracker-chrome`.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped folder (the one that holds `manifest.json`). Requires Chrome 111 or newer.
5. Click the puzzle-piece icon in the toolbar and **pin** Flip Tracker.
6. Open (or reload) the Flip page on stake.us and play as usual. Click the icon for quick stats, or click **Dashboard** for the full view.

To update later, replace the folder's contents, click the ↻ reload button on the extension's card in `chrome://extensions`, and **reload any open stake.us tabs**. If 1.0.0 recorded flips you didn't play, open the Dashboard and click **Reset stats**.

## Features
- **Totals:** flips, wins, losses, win rate, and rounds (a round is one bet, which can hold several flips before you cash out).
- **Heads vs tails** split, for your picks and for the results.
- **Streaks:** current, longest win, and longest loss streak (per flip).
- **Money, per currency (GC / SC):** total wagered, paid out, net profit/loss, and ROI. Only settled rounds count toward net and ROI.
- **Profit over time:** a cumulative line chart for each currency, drawn as inline SVG.
- **Sessions:** a new session starts after N idle minutes (default 30, can be changed).
- **Recent flips table** with date-range and currency filters. Each row shows session, round, flip #, pick, result, bet, multiplier, payout, and source.
- **Export CSV** (uses the current filters) and **Export JSON** (everything). **Import JSON** merges by ID. **Clear all data** asks for confirmation first.
- **Add flip manually**, for when automatic capture misses something.
- **Debug mode** (see below) and an **experimental DOM fallback**. Both are off by default.

### CSV columns
`timestamp_iso, session, game_in_session, flip_in_game, game_id, pick, result, outcome, bet_amount, currency, multiplier, payout, wager_counted, game_net, source`

`bet_amount` repeats on every flip of a game. To total your wagers, sum **`wager_counted`** (the amount appears only on the first flip of each game). `game_net` appears on the last flip of each finished game.

## How capture works
1. `content/main-world.js` is declared in the manifest with `"world": "MAIN"`, `"run_at": "document_start"`, `"all_frames": true` on `https://stake.us/*` and `https://*.stake.us/*`. Chrome runs it before any page script, in every frame, regardless of the page CSP.
2. It wraps `fetch`, `XMLHttpRequest`, and `WebSocket` **only to observe**. A listener on every socket sees messages whether the app uses `onmessage` or `addEventListener`. Requests and responses pass through unchanged. It never touches headers (only the content-type, to skip binary bodies). It forwards game- or bet-looking JSON to the isolated content script via `window.postMessage`, tagged `__flip_tracker_v1__`. Query strings are removed from URLs.
3. The content script parses the payload with `lib/parser.js`, which uses the mappings in **`lib/field-mappings.js`**. It keeps only these fields: timestamp, pick, result, win/loss, bet amount, currency, multiplier, payout, bet ID, flip index, and source.
4. The background service worker merges records by `betId:flipIndex`, so a Play → Next → Cashout sequence updates the same flips and doesn't duplicate them. Only your own mutation results count (see "What's new"). Public feeds and WebSocket messages never create records.
5. **DOM fallback (experimental, off by default):** this watches the on-page result history and records the result only (no pick, no money). It does this only when no network capture happened. The selectors are guesses.

### What the parser expects, and how sure we are
Stake doesn't publish a schema for Originals, and this was built without a logged-in session. The mappings come from public information about how Stake Originals respond:
- The GraphQL endpoint `/_api/graphql` returns `CasinoBet` objects: `id, active, amount, payout, payoutMultiplier, currency, updatedAt, state { __typename ... }`.
- Multi-step Originals follow a `<game>Bet / <game>Next / <game>Cashout` pattern (like Mines and Hilo).
- Newer Originals use REST-style `/_api/casino/<game>/<action>` endpoints.
- Stake.us currencies are `gold` → GC and `sweeps` → SC.
- Flip multipliers follow 0.98 × 2ⁿ.

The parser looks for Flip bets under keys such as `flipBet/flipNext/flipCashout`, a `state.__typename` matching `CasinoGameFlip`, or `game: "flip"`. It reads rounds from `rounds|flips|results|...`, with guess and result aliases. When the result side is missing, it works out win or loss from `active` and the multiplier.

**Confidence:** medium for the overall structure (CasinoBet fields, currency names, the bet/next/cashout flow). **Low** for the exact Flip names (`flipBet`, `CasinoGameFlip`, `rounds[].guess/result`). Expect to adjust `field-mappings.js` after one debug capture.

### If capture doesn't work: send us debug shapes
1. Dashboard → **Settings & data** → turn on **Debug mode**. Check the status line: "Interceptor active in N frames" should be ≥ 1 with a stake.us tab open.
2. Play 2–3 flips on stake.us, including one round where you flip again and then cash out.
3. Click **Export debug shapes** and send us the JSON file.
   Every value is replaced with `<string>` or `<number>` except game fields (guess, result, multipliers, currency, active, `__typename`, and so on). GraphQL query text is kept, with string literals stripped. Nothing from headers is ever included.
4. We update `extension/lib/field-mappings.js` only.

## Project layout
```
extension/                 ← the unpacked extension (load this folder)
  manifest.json            MV3, permissions: storage only; content script on stake.us
  background.js            service worker; serialises storage writes
  content/content.js       isolated-world content script (parse, whitelist, DOM fallback)
  content/main-world.js    MAIN-world read-only observer for fetch/XHR/WebSocket (manifest-declared, CSP-proof)
  content/overlay.js       on-page overlay + loss-warning modal (Shadow DOM)
  lib/codes-config.js      ★ official Telegram channels + code parsing rules
  lib/telegram-codes.js    t.me/s preview parser (regex; no DOM in service worker)
  lib/codes-ui.js          "Recently posted codes" panel (overlay + popup)
  lib/field-mappings.js    ★ all Stake field names / aliases (edit this one)
  lib/parser.js            payload → flip records; debug-shape redaction
  lib/records.js           record validation + merge/dedupe
  lib/stats.js             stats, sessions, CSV
  ui/popup.*, ui/dashboard.*, ui/common.js, ui/ui.css
tests/unit/                node:test parser + stats tests (mock payloads in tests/fixtures/)
tests/e2e/                 Playwright: real extension in headless Chromium on a mocked stake.us Flip page
scripts/build.sh           → dist/flip-tracker-chrome/ and dist/flip-tracker-chrome.zip
screenshots/               dashboard + popup screenshots, sample CSV/JSON/debug exports
```

## Development
```
npm install                # playwright (dev only)
npx playwright install chromium
npm test                   # unit tests
npm run test:e2e           # headless Chromium end-to-end: strict-CSP page + game iframe, public-feed rejection,
                           # games vs flips, last-25, overlay dock/pill/scroll, tracker, warning, codes, dashboard
npm run test:live          # parse the live official t.me/s pages
npm run build              # dist/flip-tracker-chrome.zip
```

## Known gaps
- The real Stake.us payloads are unverified, so the field names are educated guesses (see above).
- The DOM fallback's selectors aren't verified against the live page.
- `storage.local` holds about 10 MB, which is roughly 30–40k flips. Export JSON regularly if you play a lot.
- The code list depends on Telegram's public preview HTML. If Telegram changes its markup, update `telegram-codes.js`.
- Games left unfinished (never cashed out) show as "open". They're excluded from net and ROI until a cash-out or loss is seen.
