# Requirements · Selection Translator

[English](./REQUIREMENTS.en.md) | [简体中文](./REQUIREMENTS.md)

> This document is the specification confirmed item by item with the requester. Both the implementation and the tests follow it.

## 1. Positioning

A Chrome extension (MV3). The user selects text on a page, clicks the floating button, and a translation window opens.
Two display modes: **bilingual (for learning)** and **mono**. The target language is configurable.

## 2. User-visible flow

1. The user selects a piece of text with the mouse
2. A small “Translate” button appears next to the selection
3. Click → the button hides and the translation window **opens automatically** (loading first)
4. The window shows the result in the current mode
5. Click the close button or press `Esc` → the window disappears and the page is left untouched

**Clicking outside the window does not close it** (easy to hit the page by accident while reading).

## 3. Mode and language rules

| Selection language | Mode chosen by the user | Actual behaviour |
|---|---|---|
| Not the target language | Bilingual | Unit-by-unit: one source unit → its translation, onward unit by unit |
| Not the target language | Mono | Target-language translation only |
| **Already the target language** | Bilingual | **Mode ignored, mono forced**; the original is shown, no API call |
| **Already the target language** | Mono | The original is shown, no API call |

- “Already the target language” is decided by local language detection; no API cost.
- Simplified and Traditional Chinese are treated as the same language.
- When detection is unsure, **it translates** — foreign text is never shown as if it were already the target language.

## 4. Bilingual layout

- **Pairing unit = translation unit**: usually a whole sentence; an over-long sentence is further split into clauses, each forming its own pair.
- **Layout**: one source unit, immediately followed by its own translation; then the next unit, onward.
- **Paragraphs are only grouping**: units of the same paragraph are laid out consecutively, with a larger gap (about 20px) between paragraphs.
- **Splitting is done locally, with a single request**:
  1. Units are split locally per paragraph: `Intl.Segmenter` for sentences, plus `,` `;` `—` `–` for long sentences (fragments shorter than 28 characters are merged into a neighbour; headings / code blocks / CJK source are not split further);
  2. Units are strung back into **one piece of source text** with numbered markers (`unit0 [[0]] unit1 [[1]] …`); the source is sent once, never duplicated as a `units` array;
  3. The prompt states explicitly “this is one complete paragraph, translate it as a whole”; the model may drop a marker, meaning it merges the two neighbouring pieces;
  4. The translation is split back by those markers. Markers must be self-consistent: ordered, in range, no duplicates, no empty piece.
- **Inconsistent markers → the whole paragraph becomes one unit** (whole source ↔ whole translation), with no error, no retry and no extra request.
- Visuals: the source is primary (normal size, main colour); the translation is secondary (3px left rule + light background, slightly cooler colour). Within a unit the source→translation gap is about 4px, between units about 12px, line height 1.7–1.9.
- Both source and translation can be selected and copied.

### Mono mode

- Translation only; all unit translations of a paragraph are joined back into one paragraph.
- Joining rule: Chinese and Japanese already end with punctuation, so no space is inserted; other languages are joined with a space.

### Why split this way

A single request is a hard requirement. If the model were asked to split sentences itself, it would have to echo the source fragments back for alignment — doubling the output and requiring retries when validation fails, which is exactly why it used to be slow. Splitting locally and expressing boundaries with markers means the source is sent once and the output is only the translation; the model can still fix poor split points by dropping markers, balancing speed and semantics.

## 5. One translation covers both modes

- One request returns a unit-level structure: paragraphs → arrays of pairs `{ type, pairs: [{ src, tgt }] }`
- Bilingual = units laid out as “src → tgt” interleaved
- Mono = only `tgt` per paragraph, joined back while preserving paragraph boundaries
- Therefore **switching modes only re-renders, never re-translates** (if that ever fails, it degrades to translating per the chosen mode and re-translating on switch).

## 6. Window

| Item | Specification |
|---|---|
| Opening | Opens automatically after clicking “Translate”, loading first, then content |
| Size | Presets: small 420×420 / medium 520×560 / large 680×720 |
| Fine-tuning | Drag the bottom-right corner to resize, **size is remembered**; manual size wins over the preset |
| Position | Drag the title bar to move, **position is remembered**; centred when no record exists; always kept inside the viewport |
| Overflow | When content overflows, **the window scrolls internally** (`overflow-y: auto`); the window does not grow and does not leave the viewport |
| Closing | Bottom-bar “Close” / the enlarged top-right `×` / `Esc`; clicking outside does not close |
| Bottom bar | Persistent action bar: “⚙ Settings” on the left, “Close” on the right; also the way back to options after closing them |
| Mode switching | “Bilingual / Mono” at the top of the window, re-renders instantly; the choice is remembered as the next default |

## 7. Settings

| Item | Description |
|---|---|
| Base URL | OpenAI-compatible endpoint, filled in by the user |
| API Key | Filled in by the user, stored in `chrome.storage.local` |
| Model | Model name |
| Reading target language | Default Chinese |
| Input target language | Default English |
| Disable model thinking | On by default; dropped and remembered if the gateway rejects the parameters |
| Default display mode | Bilingual / mono |
| Window preset | Small / medium / large |
| Reset window size/position | Clears the remembered size and position |
| Test connection | Calls `/models` to probe |

Changing the preset clears the manual size so the new preset takes effect.

## 8. Technical construction

- MV3; `content_scripts` on all `http(s)`, `run_at: document_idle`, `all_frames: false`
- The `background` service worker is **the only network exit** (requests from a page are blocked by the site's CSP / CORS)
- The manifest reserves `http(s)://*/*` host permissions (required for user-supplied endpoints)
- Settings go to `chrome.storage.local`; the cache goes to `chrome.storage.session`
- Page UI is isolated with `attachShadow({ mode: 'open' })`
- esbuild bundles a self-contained IIFE with zero runtime dependencies; `dist/` can be loaded directly

## 9. Data contract

Request (the source is sent once; boundaries are numbered markers):

```json
[{ "index": 0, "type": "para", "text": "unit0 [[0]] unit1 [[1]] unit2" }]
```

The model must return (markers preserved):

```json
{
  "sourceLang": "en",
  "targetLang": "zh",
  "sameLanguage": false,
  "blocks": [{ "index": 0, "tgt": "translation with markers kept at the matching positions" }]
}
```

- `[[i]]` is the boundary between local unit i and unit i+1; the model may **drop a marker to merge**, but must not add, reorder, or renumber markers
- Consistency check: the output markers must be an ordered subsequence and every piece non-empty; otherwise → **the whole paragraph becomes one unit**
- Exactly one API request; a parse failure is reported to the user, who can retry — nothing is re-sent automatically

## 10. Non-goals (explicitly out of scope for v1)

- Streaming output
- Selections inside iframes
- Whole-page translation, hover translation
- Vocabulary book, pronunciation
- Multi-language UI

## 11. Acceptance (maps to `pnpm smoke`)

| # | Scenario | Assertions |
|---|---|---|
| 1 | Select two English paragraphs → bilingual | The mock model yields 5 units; each translation sits below its source unit; **the next unit's source comes after the previous unit's translation**; translations have a 3px left rule; the window is 520×560 and inside the viewport |
| 2 | Switch to mono | Sources disappear; two paragraph-level translations are joined back (no space for Chinese); **API call count unchanged** |
| 3 | Bottom-bar “Close” | The window closes; the top-right `×` is ≥30px; the bottom-bar “Settings” opens a new options page |
| 4 | Select a Chinese paragraph (target language) | **No API call**, mono forced, the title says no translation needed |
| 5 | Long content | Window height stays within the viewport; the content area scrolls internally |
| 6 | Resize manually, then reopen | Size is remembered; the previous mode is reused |
| 7 | Model drops a marker (mock-merge) | Two neighbouring units merge into one; **exactly 1 request** |
| 8 | Inconsistent markers (mock-broken) | Each block degrades to “one unit for the whole paragraph”; **exactly 1 request** |

## 12. Input translation

In a search box, reply box, or `contenteditable` area, select text you typed → a “译” button appears → click → **the selected text is replaced with the translation in place**.

- The target language comes from the separate **Input target language** setting (default English), independent of the reading target language;
- The source language is auto-detected; if it is already the input target language, only a notice is shown and no API is called;
- A one-shot plain-text request (`{"tgt":"..."}`); no bilingual pairing, and the reading path's marker chain is not reused;
- Writing back prefers `document.execCommand('insertText')` (fires a native `input` event, keeps the undo stack), falling back to setting the value and dispatching events;
- Covered: `input[type=text/search/email/url/tel]`, `textarea`, `contenteditable`;
- Never touched: `password`, `autocomplete=cc-*`, `disabled`/`readonly`;
- Inside iframes: not supported yet (V2);
- Failures and “already the target language” are reported with a bottom toast, without opening the translation window.

Acceptance (`pnpm smoke` scenarios 10 and 11):

| # | Scenario | Assertions |
|---|---|---|
| 10 | Select Chinese in an input → translate | The input value is replaced; the request uses the input target language (English); exactly 1 request |
| 11 | Select Chinese in a contenteditable → translate | The region's content is replaced; exactly 1 request |
