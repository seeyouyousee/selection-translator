# Selection Translator

[![CI](https://github.com/seeyouyousee/selection-translator/actions/workflows/ci.yml/badge.svg)](https://github.com/seeyouyousee/selection-translator/actions/workflows/ci.yml)

English | [简体中文](./README.md)

A Chrome MV3 extension: **select text on a page → click “Translate” → a bilingual window pops up**, built for close reading. It can also translate text you typed in an input box and replace the selection in place.

- **Bilingual, unit by unit**: one source unit → its own translation → the next unit. Paragraphs are only used for grouping and spacing.
- **One request only**: the source is sent once, with `[[n]]` markers expressing the split. The model is told each block is one complete paragraph; if a split is unreasonable it may drop a marker to merge neighbours, and the code rebuilds the pairs from the markers.
- **Mono**: translation only.
- **Input translation**: select text you typed in a search box, reply box or `contenteditable` → click “译” → the selection is replaced in place (`Ctrl+Z` to undo).
- The target language is configurable; if the selection is already in the target language, no API call is made and the source is shown in mono.
- One result serves both display modes: switching modes re-renders without re-translating.

## Screenshots

| Bilingual, unit by unit | In-place input replacement |
|---|---|
| ![Bilingual](docs/screenshots/bilingual.png) | ![Input replacement](docs/screenshots/input-replace.png) |

If the model finds a split unreasonable, it can drop a marker to merge two neighbouring pieces (still one request):

![Merge](docs/screenshots/merged.png)

If the markers are inconsistent, the whole paragraph is treated as one unit (still one request):

![Whole paragraph](docs/screenshots/whole-paragraph.png)

## Install

```bash
pnpm install
pnpm build          # output in dist/
```

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** in the top-right corner
3. Click **Load unpacked** and select the `dist/` directory of this repo
4. The options page opens automatically on first install

> `src/` cannot be loaded directly — the extension is the build output in `dist/`.

## Configuration

Options page (opens on first install; later via the toolbar icon or “Extension options” in the extension details):

| Field | Description |
|---|---|
| Base URL | Any OpenAI-compatible endpoint, e.g. `https://api.deepseek.com/v1`, `https://api.openai.com/v1` |
| API Key | Stored in `chrome.storage.local`, used only by the background service worker, never exposed to pages |
| Model | e.g. `deepseek-chat`, `gpt-4o-mini` |
| Reading target language | Language for selected page text; default Chinese |
| Input target language | Language for selected text inside input boxes; default English |
| Disable model thinking | On by default: sends thinking-off parameters; if the gateway rejects them they are dropped and remembered |
| Default display mode | Bilingual / mono (switching in the window updates the default) |
| Window size | Small 420×420 / medium 520×560 / large 680×720; a manually resized window wins |
| Test connection | Calls `/models` to probe the endpoint and key |

## Usage

1. Select some text on a page → a “译 Translate” button appears next to the selection
2. Click it → the button hides and the **window pops up automatically** (loading, then the result)
3. The “Bilingual / Mono” toggle at the top re-renders the same result instantly, without another request
4. Drag the title bar to move the window; drag the bottom-right corner to resize; size and position are remembered
5. Close with the **Close** button in the bottom bar, the `×` in the top-right, or `Esc`; **clicking outside the window does not close it**

### Input translation

1. Type in a search box, reply box, or `contenteditable` area
2. **Select the text you want to translate** → a “译” button appears next to the selection
3. Click it → the button shows “翻译中…” → when the result arrives, **the selected text is replaced with the translation**
4. Successful replacement is **silent**; only failures and “already in the target language” show a toast. `Ctrl+Z` undoes the replacement.

The window has a persistent bottom bar:

```
⚙ Settings                             Close
```

- **Settings**: opens the options page at any time (no need to hunt for the toolbar icon);
- **Close**: a large button at the bottom-right, easier to hit after reading than the small `×`;
- The top-right `×` was also enlarged to 32px and remains a quick shortcut.

**Entries to the options page** (you can always come back after closing it):

| Entry | Action |
|---|---|
| Translation window bottom bar | Click “⚙ Settings” |
| Toolbar icon | Left-click (pin the extension icon to the toolbar) |
| Toolbar icon | Right-click → “划词翻译设置” |

The selection is first grouped by DOM paragraphs. Inside each paragraph, units are split locally with rules, then strung back into **one piece of source text** with numbered markers (`unit0 [[0]] unit1 [[1]] …`) and sent to the model — the source is sent once, never duplicated. The model is explicitly told “this is one complete paragraph, translate it as a whole”, and it may drop a marker to merge two neighbouring pieces. On the way back the translation is split by those markers; the markers must be self-consistent (ordered, in range, no duplicates, no empty piece). **If they are not, the whole paragraph is treated as a single unit** — no error, no retry. There is exactly one API request. The same rule-based split is also used for local display when the selection is already in the target language (no API call).

**Thinking is disabled by default**: the request explicitly sends `reasoning_effort: "none"`, `enable_thinking: false` and `thinking: {"type": "disabled"}`. If a gateway rejects these parameters with a 400, the extension drops them, retries once and remembers it for the session. This behaviour can be turned off in Settings.

## Privacy

- The API key and settings live only in the local `chrome.storage.local` and are never uploaded anywhere;
- Text is sent to **your own** OpenAI-compatible endpoint only when **you explicitly trigger** a translation;
- No page content is collected, no analytics, no remote logs;
- The cache lives only in `chrome.storage.session` and is cleared when the browser closes.

## Development

```bash
pnpm install
pnpm build        # bundle into dist/
pnpm watch        # rebuild on change
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest: language detection / splitting / marker parsing (50 tests)
pnpm smoke        # real-browser smoke: Chromium loads dist/ + a local mock LLM, full flow + screenshots
pnpm timing       # timing diagnostics (DELAY=1500 pnpm timing simulates model latency)
```

The smoke test needs Chromium. **Branded Chrome has hard-blocked `--load-extension` since version 137** (the binary literally prints “not allowed in Google Chrome, ignoring”), so `pnpm smoke` looks for a Chromium build by default; override with `CHROME_PATH=/path/to/chrome pnpm smoke`.

Smoke output goes to `test/smoke/out/`: `bilingual.png`, `mono.png`, `same-language.png`, `long-scroll.png`, `restored-size.png`, `merged.png`, `whole-paragraph.png`, plus `run.log`. There are 11 scenarios; besides screenshot assertions they check: translations sit below their source, translations have a 3px left rule, the window size matches the preset, long content scrolls inside the window, manual size and mode are remembered, **the bottom-bar “Settings” opens a new options page**, **the `×` is at least 30px**, **the bottom-bar “Close” closes the window**, **dropping a marker merges two units**, **inconsistent markers degrade to the whole paragraph**, and **select-and-replace works in input fields and contenteditable** — all with exactly one request.

To diagnose latency: `chrome://extensions` → the extension's “service worker” → “inspect” → Console. Every translation logs `[st] requests=N xxxms reasoning=N blocks=N units=N`.

## Key design decisions

| Decision | Why |
|---|---|
| Source sent once + markers express the split | No duplicated source (no `units` array), minimum input; markers are the single source of truth for splits |
| One request, no retry, no fallback | Speed is a hard requirement; inconsistent markers only downgrade the display, never add requests |
| Marker consistency check | Ordered / in range / no duplicates / non-empty pieces; otherwise the whole paragraph becomes one unit |
| The model may drop markers to merge | When the local split is poor, “drop a marker” is a natural way for the model to merge |
| One call returns unit-level `{src, tgt}` | Bilingual = interleaved units; mono = units joined back per paragraph. Switching is free |
| Local language detection short-circuit | No API time or money spent on text already in the target language |
| Missing/inconsistent counts are errors | Better to show an error and let the user retry than to misalign silently |
| `response_format=json_object`, fallback on 400 | Compatible with gateways that do not support it |
| One backoff retry on 429/5xx | Transient upstream errors should not require manual retries |
| `chrome.storage.session` LRU cache | Repeated selections return instantly; cleared when the browser closes |
| Shadow DOM + fixed-position host | Site styles cannot leak in, and the page body is untouched |

## Known limitations

- Main frame only (`all_frames: false`); selections inside iframes are not handled.
- Language detection is heuristic: **when unsure it translates** rather than showing foreign text as if it were already the target language.
- Markers are advisory: the model may drop all (→ one pair for the whole paragraph) or keep all (→ local granularity); neither adds requests.
- Local splitting sets the granularity ceiling: the model can merge but not split finer.
- Rule-based splitting: `Intl.Segmenter` for sentences plus punctuation-based splitting for long sentences; a long sentence with no punctuation cannot be split.
- Input translation covers `input[type=text/search/email/url/tel]`, `textarea` and `contenteditable`; password and credit-card fields are never touched.
- Input boxes inside iframes are not supported yet.
- Limits: 8000 characters / 200 blocks per request; beyond that only a notice, no request.
- v1 has no streaming (structured block layout does not suit incremental rendering).
- The cache lives in the session and is cleared when the browser closes.

## Layout

```
src/
  manifest.json          MV3 manifest
  entries/content.ts     content script entry: selection watching / floating button / window wiring
  entries/background.ts  service worker: the only network exit (API / parsing / cache)
  content/extract.ts     selection → paragraph blocks (DOM structure first, plain-text fallback)
  content/segment.ts     local rule-based splitting (sets granularity; also used for same-language display)
  content/ui/            floating button, translation window, Shadow DOM styles
  options/               options page
  shared/                types, language detection, result parsing, settings, messaging
build/build.mjs          esbuild bundling (IIFE, zero runtime deps)
test/                    vitest unit tests + Chromium smoke test
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Read [REQUIREMENTS.en.md](./REQUIREMENTS.en.md) first — it pins down a few constraints that must not be broken.

## License

[MIT](./LICENSE)
