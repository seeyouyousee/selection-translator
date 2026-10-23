/**
 * 解析模型返回（一次调用，原文只发一次）。
 *
 * 契约：
 *   发送  [{ index, type, text: "unit0 [[0]] unit1 [[1]] unit2 ..." }]
 *   返回  { blocks: [{ index, tgt: "译文（保留标记）" }] }
 *
 * 标记语义：`[[i]]` 是第 i 与第 i+1 个本地单元之间的展示边界。
 * 模型可以丢掉某个标记（= 把相邻两块合并），但不能新增、乱序、改号。
 *
 * 自洽校验：输出标记必须是输入标记的**有序子序列**、每块译文非空。
 * 不满足 → 整段作为一个整体（整段原文 ↔ 整段译文），不报错、不重试。
 */

import type { SegmentBlock, SentencePair, TransBlock, TranslateResult } from './types';

export class TranslateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslateParseError';
  }
}

/* ---------------- 从聊天响应里取文本 ---------------- */

export function chatContent(json: unknown): string {
  const j = json as {
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
    content?: unknown;
  } | null;
  const choice = j?.choices?.[0];
  const raw = choice?.message?.content ?? choice?.text ?? j?.content;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === 'string') return part;
        const p = part as { text?: unknown };
        return typeof p?.text === 'string' ? p.text : '';
      })
      .join('');
  }
  return '';
}

/* ---------------- 从自由文本里抠出第一个 JSON 对象/数组 ---------------- */

export function extractJsonValue(input: string): unknown {
  const s = String(input ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/* ---------------- 标记切分与校验 ---------------- */

const MARKER_RE = /\[\[(\d+)\]\]/g;

function stripMarkers(text: string): string {
  return text.replace(MARKER_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
}

interface SplitMarked {
  pieces: string[];
  markers: number[];
}

/**
 * 按标记切译文，并做自洽校验：
 *  - 标记编号严格递增（= 不重复、不乱序）；
 *  - 编号在 [0, boundaries) 内（= 不新增越界标记）；
 *  - 每块译文非空。
 * 任一条不满足返回 null，由调用方降级为「整段作为一个整体」。
 */
function splitMarked(text: string, boundaries: number): SplitMarked | null {
  const pieces: string[] = [];
  const markers: number[] = [];
  let cursor = 0;
  let last = -1;

  MARKER_RE.lastIndex = 0;
  let match = MARKER_RE.exec(text);
  while (match) {
    const id = Number(match[1]);
    if (!Number.isInteger(id) || id <= last || id >= boundaries) return null;

    const piece = text.slice(cursor, match.index).trim();
    if (!piece) return null;
    pieces.push(piece);
    markers.push(id);

    cursor = match.index + match[0].length;
    last = id;
    match = MARKER_RE.exec(text);
  }

  const tail = text.slice(cursor).trim();
  if (!tail) return null;
  pieces.push(tail);

  return { pieces, markers };
}

/** 把被合并的若干源单元拼回去（中日文不加空格）。 */
function joinSource(units: string[]): string {
  if (units.length <= 1) return units[0] ?? '';
  const joined = units.join(' ');
  const cjk = joined.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0;
  if (cjk > 0 && cjk / joined.length > 0.3) return units.join('');
  return joined;
}

/* ---------------- 单元级解析 ---------------- */

export function parseMarkedResult(
  content: string,
  blocks: SegmentBlock[],
  targetLang: string,
): TranslateResult {
  const value = extractJsonValue(content);
  if (!isRecord(value)) throw new TranslateParseError('模型返回的内容不是可解析的 JSON');

  const rawBlocks = value.blocks;
  if (!Array.isArray(rawBlocks)) throw new TranslateParseError('模型返回的 JSON 里没有 blocks');
  if (rawBlocks.length !== blocks.length) {
    throw new TranslateParseError(`模型返回 ${rawBlocks.length} 段，期望 ${blocks.length} 段`);
  }

  const byIndex = new Map<number, string>();
  rawBlocks.forEach((raw, position) => {
    if (!isRecord(raw)) return;
    const index = typeof raw.index === 'number' ? raw.index : position;
    const tgt = typeof raw.tgt === 'string' ? raw.tgt : '';
    byIndex.set(index, tgt);
  });

  const out: TransBlock[] = blocks.map((block, bi) => {
    const rawTgt = byIndex.get(bi);
    if (rawTgt === undefined) throw new TranslateParseError(`第 ${bi + 1} 段缺失`);

    const tgtText = rawTgt.trim();
    if (!tgtText) throw new TranslateParseError(`第 ${bi + 1} 段译文为空`);

    const boundaries = Math.max(0, block.units.length - 1);
    const marked = splitMarked(tgtText, boundaries);

    // 标记不自洽 → 整段作为一个整体
    if (!marked) {
      const whole = stripMarkers(tgtText);
      if (!whole) throw new TranslateParseError(`第 ${bi + 1} 段译文为空`);
      return { type: block.type, pairs: [{ src: block.text, tgt: whole }] };
    }

    const pairs: SentencePair[] = [];
    let start = 0;
    marked.pieces.forEach((piece, p) => {
      const end = p < marked.markers.length ? marked.markers[p] : block.units.length - 1;
      pairs.push({ src: joinSource(block.units.slice(start, end + 1)), tgt: piece });
      start = end + 1;
    });

    return { type: block.type, pairs };
  });

  const sourceLang = typeof value.sourceLang === 'string' ? value.sourceLang : '';
  const outTarget =
    typeof value.targetLang === 'string' && value.targetLang ? value.targetLang : targetLang;
  const sameLanguage =
    value.sameLanguage === true || out.every((b) => b.pairs.every((p) => p.src === p.tgt));

  return { sourceLang, targetLang: outTarget, sameLanguage, blocks: out };
}
