/**
 * 本地规则切分：决定对照粒度。
 *
 * 切分放在本地，才能在「只发一次请求」的前提下把单元与译文一一对齐；
 * 模型拿到的是用标记串好的一段原文，只能合并、不能再切细。
 * 选区已经是目标语言时，也用它做本地展示（不调 API）。
 *
 * 粒度是两级的：
 *   1. 先按句末标点切句（Intl.Segmenter，ICU 驱动）；
 *   2. 长句再按分句切开（逗号 / 分号 / 破折号），太短的碎片并回相邻片段。
 *
 * 标题与代码块不细拆；中日韩原文不细拆（避免中文被切得过碎）。
 */

import type { SegmentBlock, SourceBlock } from '../shared/types';

let cached: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (cached !== undefined) return cached;
  try {
    cached =
      typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'sentence' })
        : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** 把一段文本切成句子。切不出来就返回整段。 */
export function splitSentences(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const segmenter = getSegmenter();
  if (!segmenter) return [t];

  const out: string[] = [];
  for (const part of segmenter.segment(t)) {
    const sentence = part.segment.trim();
    if (sentence) out.push(sentence);
  }
  return out.length > 0 ? out : [t];
}

/** 超过这个长度才考虑细拆分句。 */
const LONG_SENTENCE = 72;
/** 拆出来的碎片短于这个长度，就并回相邻片段。 */
const MIN_CHUNK = 28;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;

/**
 * 长句 → 分句。短句原样返回。
 *
 * 切的边界：`,` `,` `;` `；`（数字里的千位逗号不切）、`—` `–`、两侧带空格的 `-`。
 * 破折号本身不保留（它是分隔符，不是内容）。
 */
export function splitClauses(sentence: string): string[] {
  const s = sentence.trim();
  if (s.length <= LONG_SENTENCE) return [s];

  const cjk = s.match(CJK)?.length ?? 0;
  if (cjk / s.length > 0.15) return [s];

  const parts = cutAtBoundaries(s);
  if (parts.length <= 1) return [s];
  return mergeShort(parts);
}

function cutAtBoundaries(s: string): string[] {
  const out: string[] = [];
  let start = 0;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const prev = s[i - 1] ?? '';
    const next = s[i + 1] ?? '';

    if (ch === ',' || ch === ';' || ch === '，' || ch === '；') {
      // 1,000 / 12,500 这类数字不切
      if (ch === ',' && /\d/.test(prev) && /\d/.test(next)) continue;
      // 收尾引号/括号跟着前一片走（例如 `...," an official said.`）
      let j = i + 1;
      while (j < s.length && /["'”’)\]}]/.test(s[j])) j += 1;
      const piece = s.slice(start, j).trim();
      if (piece) out.push(piece);
      start = j;
      i = j - 1;
      continue;
    }

    const isDash = ch === '—' || ch === '–' || (ch === '-' && /\s/.test(prev) && /\s/.test(next));
    if (isDash) {
      const piece = s.slice(start, i).trim();
      if (piece) out.push(piece);
      // 吃掉破折号与它两侧的空白
      while (i < s.length - 1 && /[\s—–-]/.test(s[i + 1])) i += 1;
      start = i + 1;
    }
  }

  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function mergeShort(parts: string[]): string[] {
  const out: string[] = [];
  let buf = '';

  for (const raw of parts) {
    const t = raw.trim();
    if (!t) continue;
    buf = buf ? `${buf} ${t}` : t;
    if (buf.length >= MIN_CHUNK) {
      out.push(buf);
      buf = '';
    }
  }

  if (buf) {
    if (out.length > 0) out[out.length - 1] = `${out[out.length - 1]} ${buf}`;
    else out.push(buf);
  }

  return out;
}

/**
 * 段落块 → 可翻译单元。
 * 代码块 / 标题不切；普通段落先切句，长句再切分句。
 */
export function segmentBlocks(blocks: SourceBlock[]): SegmentBlock[] {
  const out: SegmentBlock[] = [];

  for (const block of blocks) {
    let units: string[];
    if (block.type === 'code' || block.type === 'heading') {
      units = [block.text];
    } else {
      units = splitSentences(block.text).flatMap((sentence) => splitClauses(sentence));
    }
    if (units.length > 0) out.push({ type: block.type, text: block.text, units });
  }

  return out;
}
