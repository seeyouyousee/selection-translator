/**
 * 后台 service worker：扩展里唯一能自由出网的地方。
 *
 * 页面内直接 fetch 第三方 API 会被站点 CSP / 跨域限制卡住；
 * 这里带着 manifest 的 host 权限发请求，不受这些限制。
 *
 * 翻译只有一次请求：
 *   本地切好单元 → 单元用编号标记串回一段原文发出 → 模型整体翻译并保留标记
 *   （切分不合理可丢标记合并）→ 这里按标记还原对照。
 *   标记不自洽时整段作为一个整体，不重试、不追加请求。
 */

import { MAX_BLOCKS, MAX_CHARS, MAX_SENTENCES, errMessage } from '../shared/types';
import type { ApiResponse, InputTranslateResult, SegmentBlock, SourceBlock, TranslateResult } from '../shared/types';
import { loadSettings } from '../shared/settings';
import { detectLanguage, langEn, sameLangFamily } from '../shared/lang';
import { TranslateParseError, chatContent, extractJsonValue, parseMarkedResult } from '../shared/parse';
import { segmentBlocks } from '../content/segment';
import type { Msg, MsgMap } from '../shared/messaging';

const CACHE_KEY = 'translate-cache';
const CACHE_MAX = 40;
const CACHE_TTL = 1000 * 60 * 30;
const TIMEOUT_MS = 60_000;

class ApiFailure extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
  }
}

/* ---------------- 消息入口 ---------------- */

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((e: unknown) => {
      sendResponse({ ok: false, error: { code: 'INTERNAL', message: errMessage(e) } });
    });
  return true;
});

chrome.action?.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onInstalled.addListener((details) => {
  // 扩展图标右键 →「划词翻译设置」：设置页关掉后的第二个入口
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      { id: 'st-settings', title: '划词翻译设置', contexts: ['action'] },
      () => void chrome.runtime.lastError,
    );
  });
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'st-settings') void chrome.runtime.openOptionsPage();
});

async function handle(msg: Msg): Promise<ApiResponse<unknown>> {
  switch (msg.type) {
    case 'st:get-config':
      return ok(await getPublicConfig());
    case 'st:translate':
      return handleTranslate(msg.blocks, msg.targetLang);
    case 'st:translate-input':
      return handleTranslateInput(msg.text);
    case 'st:open-options':
      await chrome.runtime.openOptionsPage();
      return ok(true);
    case 'st:test-connection':
      return handleTestConnection(msg.baseUrl, msg.apiKey, msg.model);
    default:
      return fail('BAD_MESSAGE', '未知的消息类型');
  }
}

async function getPublicConfig(): Promise<MsgMap['st:get-config']> {
  const s = await loadSettings();
  return {
    targetLang: s.targetLang,
    mode: s.mode,
    windowPreset: s.windowPreset,
    windowDims: s.windowDims,
    windowPos: s.windowPos,
    hasKey: s.apiKey.length > 0,
  };
}

/* ---------------- 翻译 ---------------- */

async function handleTranslate(rawBlocks: unknown, targetLang: unknown): Promise<ApiResponse<TranslateResult>> {
  try {
    const blocks = normalizeBlocks(rawBlocks);
    if (blocks.length === 0) return fail('EMPTY', '没有可翻译的内容');
    if (typeof targetLang !== 'string' || !targetLang) return fail('BAD_TARGET', '目标语言无效');
    if (blocks.length > MAX_BLOCKS) return fail('TOO_MANY', `段落太多（${blocks.length} 段），请分段翻译`);

    const total = blocks.reduce((n, b) => n + b.text.length, 0);
    if (total > MAX_CHARS) return fail('TOO_LONG', `内容约 ${total} 字，超过上限 ${MAX_CHARS} 字`);

    // 本地切好单元；整段原文一起发给模型当上下文
    const segmented = segmentBlocks(blocks);
    const unitCount = segmented.reduce((n, b) => n + b.units.length, 0);
    if (unitCount === 0) return fail('EMPTY', '没有可翻译的内容');
    if (unitCount > MAX_SENTENCES) {
      return fail('TOO_MANY', `翻译单元太多（${unitCount} 个），请分段翻译`);
    }

    const joined = blocks.map((b) => b.text).join('\n');
    const detected = detectLanguage(joined);
    if (sameLangFamily(detected, targetLang)) {
      return ok({
        sourceLang: targetLang,
        targetLang,
        sameLanguage: true,
        blocks: segmented.map((b) => ({
          type: b.type,
          pairs: b.units.map((u) => ({ src: u, tgt: u })),
        })),
      });
    }

    const settings = await loadSettings();
    if (!settings.apiKey) return fail('NO_KEY', '还没有配置 API Key，请先在扩展设置里填写');

    const cacheKey = makeCacheKey(settings.baseUrl, settings.model, targetLang, blocks);
    const cached = await readCache(cacheKey);
    if (cached) return ok(cached);

    // 只发一次请求：本地已切好单元，模型结合整段上下文逐条返回译文。
    // 没有重试、没有二次调用；解析/数量对不上就报错让用户点重试。
    const started = Date.now();
    const chat = await callChat(settings, buildMessages(segmented, targetLang));
    const result = parseMarkedResult(chat.content, segmented, targetLang);
    if (chat.reasoning > 0) {
      console.warn(
        settings.disableThinking !== false
          ? `[st] 已发送关闭思考参数，但模型仍返回 reasoning_tokens=${chat.reasoning}：网关忽略了参数，或该型号强制思考，建议换非思考模型`
          : `[st] 模型启用了思考模式（reasoning_tokens=${chat.reasoning}），会明显变慢；可在设置里勾选「关闭模型思考」`,
      );
    }
    console.info(
      `[st] requests=${chat.requests} ${Date.now() - started}ms reasoning=${chat.reasoning} blocks=${blocks.length} units=${unitCount}`,
    );

    result.sourceLang = result.sourceLang || detected || '';
    result.targetLang = targetLang;

    void writeCache(cacheKey, result);
    return ok(result);
  } catch (e) {
    if (e instanceof TranslateParseError) return fail('PARSE', e.message);
    if (e instanceof ApiFailure) return fail(e.code, e.message);
    return fail('UNKNOWN', errMessage(e));
  }
}

function normalizeBlocks(raw: unknown): SourceBlock[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(['heading', 'para', 'list', 'quote', 'code']);
  const out: SourceBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const b = item as { type?: unknown; text?: unknown };
    if (typeof b.text !== 'string') continue;
    const text = b.text.trim();
    if (!text) continue;
    const type =
      typeof b.type === 'string' && allowed.has(b.type) ? (b.type as SourceBlock['type']) : 'para';
    out.push({ type, text });
  }
  return out;
}

/* ---------------- 输入框翻译（纯文本进、纯文本出） ---------------- */

async function handleTranslateInput(rawText: unknown): Promise<ApiResponse<InputTranslateResult>> {
  try {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) return fail('EMPTY', '没有可翻译的内容');
    if (text.length > MAX_CHARS) return fail('TOO_LONG', `内容约 ${text.length} 字，超过上限 ${MAX_CHARS} 字`);

    const settings = await loadSettings();
    if (!settings.apiKey) return fail('NO_KEY', '还没有配置 API Key，请先在扩展设置里填写');

    const target = settings.inputTargetLang;
    const detected = detectLanguage(text);
    if (sameLangFamily(detected, target)) {
      return ok({ tgt: text, sourceLang: target, sameLanguage: true });
    }

    const chat = await callChat(settings, buildInputMessages(text, target));
    const tgt = parseInputResult(chat.content);
    console.info(`[st] input requests=${chat.requests} reasoning=${chat.reasoning} chars=${text.length}`);
    return ok({ tgt, sourceLang: detected ?? '', sameLanguage: false });
  } catch (e) {
    if (e instanceof TranslateParseError) return fail('PARSE', e.message);
    if (e instanceof ApiFailure) return fail(e.code, e.message);
    return fail('UNKNOWN', errMessage(e));
  }
}

function buildInputMessages(text: string, targetLang: string): Array<{ role: string; content: string }> {
  const target = langEn(targetLang);
  return [
    {
      role: 'system',
      content: [
        `You translate text that the user is about to paste into a website input box. Translate into ${target}.`,
        '',
        'Return JSON only, with no markdown fence:',
        '{"tgt":"..."}',
        '',
        'Rules:',
        '- Translate the whole text as one message; keep it natural and concise.',
        '- Preserve line breaks and markdown formatting.',
        '- Do not add quotes, explanations, or the original text.',
        '- Keep names, numbers, URLs, code and emoji unchanged.',
      ].join('\n'),
    },
    { role: 'user', content: text },
  ];
}

function parseInputResult(content: string): string {
  const value = extractJsonValue(content);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const tgt = v.tgt ?? v.translation ?? v.text;
    if (typeof tgt === 'string' && tgt.trim()) return tgt.trim();
  }
  const plain = content.trim();
  if (plain && !plain.startsWith('{')) return plain;
  throw new TranslateParseError('模型返回的内容无法解析');
}

/* ---------------- Prompt ---------------- */

/** 把本地单元用编号标记串成一段原文：unit0 [[0]] unit1 [[1]] ... */
function markUnits(units: string[]): string {
  if (units.length <= 1) return units[0] ?? '';
  const probe = units.join(' ');
  const cjk = probe.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0;
  const sep = cjk > 0 && cjk / probe.length > 0.3 ? '' : ' ';
  let out = units[0] ?? '';
  for (let i = 1; i < units.length; i += 1) {
    out += `${sep}[[${i - 1}]]${sep}${units[i]}`;
  }
  return out;
}

function buildMessages(
  blocks: SegmentBlock[],
  targetLang: string,
): Array<{ role: string; content: string }> {
  const target = langEn(targetLang);
  const system = [
    `You are a professional translator working for a language-learning reading tool. Translate into ${target}.`,
    '',
    'The user message is a JSON array of paragraph blocks: [{"index":0,"type":"para","text":"..."}].',
    'Each `text` is ONE complete paragraph. Translate it as a whole, with its full context — do not translate fragment by fragment in isolation.',
    '',
    '`[[n]]` are display boundary markers inserted between locally pre-split units. They are not content: do not translate them and do not change their numbers.',
    '- Keep the markers at the corresponding positions in your translation.',
    '- If a local split point is unreasonable (it cuts through the meaning), you may DROP that marker, which merges the two neighboring pieces into one. Never add markers, never reorder them, never renumber them.',
    '',
    'Return JSON only, with no markdown fence, in exactly this shape:',
    '{"sourceLang":"<ISO 639-1>","targetLang":"' + targetLang + '","sameLanguage":false,"blocks":[{"index":0,"tgt":"translated paragraph, markers kept"}]}',
    '',
    'Hard rules:',
    '- Return exactly one block per input block, with the same index.',
    '- Translate the whole paragraph: do not omit, summarize, or add content.',
    '- Keep code, URLs, emails, numbers and identifiers unchanged.',
    '- type=heading → concise heading; type=list → keep the item semantics; type=quote → keep the quoted tone; type=code → return the code unchanged.',
    `- If the whole input is already in ${target}, set sameLanguage=true and return the text unchanged.`,
  ].join('\n');

  const user = JSON.stringify(
    blocks.map((b, index) => ({ index, type: b.type, text: markUnits(b.units) })),
  );

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/* ---------------- HTTP ---------------- */

function endpoint(baseUrl: string, path: string): string {
  let base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  if (base.endsWith('/chat/completions')) {
    return path === 'chat/completions' ? base : base.replace(/\/chat\/completions$/, `/${path}`);
  }
  return `${base}/${path}`;
}

interface PostResult {
  ok: boolean;
  status: number;
  text: string;
}

async function postChat(baseUrl: string, apiKey: string, body: Record<string, unknown>): Promise<PostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

interface ChatSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 是否在请求里显式发送关闭思考参数 */
  disableThinking?: boolean;
}

interface ChatOutcome {
  content: string;
  /** 这次翻译实际发出的 /chat/completions 请求数（正常是 1） */
  requests: number;
  /** 模型内部思考消耗的 token；> 0 说明模型在「思考模式」下运行 */
  reasoning: number;
}

const NO_JSON_FLAG = 'no-json-mode';
const NO_THINKING_FLAG = 'no-thinking-params';

async function thinkingParamsDisabled(): Promise<boolean> {
  try {
    const bag = await chrome.storage.session.get(NO_THINKING_FLAG);
    return bag?.[NO_THINKING_FLAG] === true;
  } catch {
    return false;
  }
}

async function rememberThinkingParamsDisabled(): Promise<void> {
  try {
    await chrome.storage.session.set({ [NO_THINKING_FLAG]: true });
  } catch {
    /* ignore */
  }
}

async function jsonModeDisabled(): Promise<boolean> {
  try {
    const bag = await chrome.storage.session.get(NO_JSON_FLAG);
    return bag?.[NO_JSON_FLAG] === true;
  } catch {
    return false;
  }
}

async function rememberJsonModeDisabled(): Promise<void> {
  try {
    await chrome.storage.session.set({ [NO_JSON_FLAG]: true });
  } catch {
    /* ignore */
  }
}

async function tryPost(settings: ChatSettings, body: Record<string, unknown>): Promise<PostResult> {
  try {
    return await postChat(settings.baseUrl, settings.apiKey, body);
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      throw new ApiFailure('TIMEOUT', '翻译请求超时（60 秒），请稍后重试或分段翻译');
    }
    throw new ApiFailure('NETWORK', `无法连接翻译服务：${errMessage(e)}（检查 Base URL 与网络）`);
  }
}

async function callChat(
  settings: ChatSettings,
  messages: Array<{ role: string; content: string }>,
): Promise<ChatOutcome> {
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    stream: false,
  };
  // 显式关闭思考：不同网关认不同字段，一起发，能认哪个算哪个
  const thinkingOff = settings.disableThinking !== false && !(await thinkingParamsDisabled());
  if (thinkingOff) {
    body.reasoning_effort = 'none';
    body.enable_thinking = false;
    body.thinking = { type: 'disabled' };
  }
  // 网关不支持 json_object 时，记住它，之后不再白发一次
  if (!(await jsonModeDisabled())) body.response_format = { type: 'json_object' };

  let requests = 1;
  let result = await tryPost(settings, body);

  // 兼容路径：网关不认识关闭思考参数 → 去掉重试一次，并记住
  if (
    !result.ok &&
    result.status === 400 &&
    thinkingOff &&
    /thinking|reasoning_effort|enable_thinking|unknown|unrecognized|extra|not allowed/i.test(result.text)
  ) {
    console.warn(
      '[st] 网关不接受关闭思考参数，去掉后重试一次（本次翻译第 2 次请求；之后会记住不再发）',
    );
    await rememberThinkingParamsDisabled();
    delete body.reasoning_effort;
    delete body.enable_thinking;
    delete body.thinking;
    requests += 1;
    result = await tryPost(settings, body);
  }

  // 兼容路径：网关不认 response_format 时会多发一次（会打 warn，便于排查）
  if (
    !result.ok &&
    result.status === 400 &&
    /response_format|json_object|unsupported|not support/i.test(result.text)
  ) {
    console.warn('[st] 网关不接受 response_format，重试一次（本次翻译第 2 次请求；之后会记住）');
    await rememberJsonModeDisabled();
    delete body.response_format;
    requests += 1;
    result = await tryPost(settings, body);
  }

  // 上游 429/5xx：等 900ms 再试一次（会打 warn）
  if (!result.ok && (result.status === 429 || result.status >= 500)) {
    console.warn(`[st] 上游 ${result.status}，900ms 后重试一次（本次翻译第 2 次请求）`);
    await sleep(900);
    requests += 1;
    result = await tryPost(settings, body);
  }

  if (!result.ok) throw httpFailure(result.status, result.text);

  let json: unknown;
  try {
    json = JSON.parse(result.text);
  } catch {
    throw new ApiFailure('BAD_RESPONSE', '翻译服务返回的不是 JSON');
  }

  const content = chatContent(json);
  if (!content.trim()) throw new ApiFailure('EMPTY', '模型返回了空内容');

  const usage = (json as { usage?: { completion_tokens_details?: { reasoning_tokens?: unknown } } })
    .usage;
  const rawReasoning = usage?.completion_tokens_details?.reasoning_tokens;
  const reasoning = typeof rawReasoning === 'number' ? rawReasoning : 0;

  return { content, requests, reasoning };
}

function httpFailure(status: number, body: string): ApiFailure {
  const detail = apiErrorDetail(body);
  if (status === 401 || status === 403) {
    return new ApiFailure('AUTH', `API Key 无效或没有权限（${status}）：${detail}`);
  }
  if (status === 404) {
    return new ApiFailure('ENDPOINT', `端点不存在（404）：${detail}。请检查 Base URL，例如 https://api.deepseek.com/v1`);
  }
  if (status === 429) {
    return new ApiFailure('RATE', `请求过于频繁或额度不足（429）：${detail}`);
  }
  if (status >= 500) {
    return new ApiFailure('UPSTREAM', `翻译服务暂时不可用（${status}）：${detail}`);
  }
  return new ApiFailure('HTTP', `请求失败（${status}）：${detail}`);
}

function apiErrorDetail(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown };
    const m = j?.error?.message ?? j?.message;
    if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 300);
  } catch {
    /* ignore */
  }
  return body.trim().slice(0, 200) || '无附加信息';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------- 缓存（chrome.storage.session，内存级） ---------------- */

interface CacheEntry {
  t: number;
  r: TranslateResult;
}

type CacheBag = Record<string, CacheEntry>;

async function readCache(key: string): Promise<TranslateResult | null> {
  try {
    const bag = await chrome.storage.session.get(CACHE_KEY);
    const cache = (bag?.[CACHE_KEY] ?? {}) as CacheBag;
    const hit = cache[key];
    if (!hit) return null;
    if (Date.now() - hit.t > CACHE_TTL) return null;
    return hit.r;
  } catch {
    return null;
  }
}

async function writeCache(key: string, result: TranslateResult): Promise<void> {
  try {
    const bag = await chrome.storage.session.get(CACHE_KEY);
    const cache = { ...((bag?.[CACHE_KEY] ?? {}) as CacheBag), [key]: { t: Date.now(), r: result } };
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) {
      keys
        .sort((a, b) => cache[a].t - cache[b].t)
        .slice(0, keys.length - CACHE_MAX)
        .forEach((k) => delete cache[k]);
    }
    await chrome.storage.session.set({ [CACHE_KEY]: cache });
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function makeCacheKey(baseUrl: string, model: string, targetLang: string, blocks: SourceBlock[]): string {
  const sig = blocks.map((b) => `${b.type}\u0003${b.text}`).join('\u0002');
  return `${targetLang}|${model}|${fnv1a(baseUrl)}|${fnv1a(sig)}|${sig.length}`;
}

/* ---------------- 连接测试 ---------------- */

async function handleTestConnection(
  baseUrl: unknown,
  apiKey: unknown,
  model: unknown,
): Promise<ApiResponse<MsgMap['st:test-connection']>> {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) return fail('BAD_URL', '请先填写 Base URL');
  if (typeof apiKey !== 'string' || !apiKey.trim()) return fail('NO_KEY', '请先填写 API Key');
  if (typeof model !== 'string' || !model.trim()) return fail('BAD_MODEL', '请先填写模型名');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(endpoint(baseUrl, 'models'), {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 404) {
        return fail('NO_MODELS', '该端点不支持 /models 探测（404）。请直接翻译一次来验证 Key 是否可用。');
      }
      throw httpFailure(res.status, text);
    }
    let models: string[] = [];
    try {
      const j = JSON.parse(text) as { data?: Array<{ id?: unknown }> };
      models = (j.data ?? []).map((m) => String(m?.id ?? '')).filter(Boolean);
    } catch {
      /* ignore */
    }
    return ok({ status: res.status, models: models.slice(0, 50) });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      return fail('TIMEOUT', '连接测试超时，请检查网络与 Base URL');
    }
    if (e instanceof ApiFailure) return fail(e.code, e.message);
    return fail('NETWORK', `无法连接：${errMessage(e)}`);
  }
}

/* ---------------- helpers ---------------- */

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

function fail(code: string, message: string): ApiResponse<never> {
  return { ok: false, error: { code, message } };
}
