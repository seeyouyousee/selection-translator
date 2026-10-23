/**
 * 选区 → 段落块。
 *
 * 这里只负责“按 DOM 的块级结构分组”，**不切句**：段落是分组单位，
 * 切句交给 segment.ts（Intl.Segmenter）。模型既不参与分组也不参与切句。
 */

import type { BlockType, SourceBlock } from '../shared/types';

export interface SelectionPayload {
  blocks: SourceBlock[];
  text: string;
}

const SKIP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'TEXTAREA', 'INPUT',
  'SELECT', 'BUTTON', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'LINK', 'META', 'HEAD', 'TITLE',
]);

const BLOCK = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'FIGURE', 'FIGCAPTION',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'TR', 'TD', 'TH',
  'DL', 'DT', 'DD', 'ADDRESS', 'DETAILS', 'SUMMARY', 'FORM', 'FIELDSET', 'HR', 'CAPTION',
]);

/** 这些块级元素可能包着更小的块，需要继续往里走而不是整体当一个段落。 */
const CONTAINER = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'FIGURE', 'FIGCAPTION',
  'LI', 'BLOCKQUOTE', 'TD', 'TH', 'DL', 'DT', 'DD', 'FORM', 'FIELDSET', 'DETAILS', 'CAPTION',
]);

/** <br> 的占位符：最后才还原成真正的换行，避免被空白折叠吃掉。 */
const BR = '\u000B';

function tagOf(el: Element): string {
  return el.tagName.toUpperCase();
}

function isBlockTag(tag: string): boolean {
  return BLOCK.has(tag);
}

function typeOf(tag: string): BlockType {
  if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') return 'heading';
  if (tag === 'LI') return 'list';
  if (tag === 'BLOCKQUOTE') return 'quote';
  if (tag === 'PRE') return 'code';
  return 'para';
}

function hasBlockChild(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (isBlockTag(tagOf(child))) return true;
  }
  return false;
}

/** 取元素文本，<br> 记成占位符（保留原作者的分行意图）。 */
function textOf(node: Node): string {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.nodeValue ?? '';
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = tagOf(el);
    if (SKIP.has(tag)) continue;
    if (tag === 'BR') {
      out += BR;
      continue;
    }
    out += textOf(el);
  }
  return out;
}

/** 统一空白：普通段落折成一行（<br> 保留），代码块保留原样。 */
export function normalizeText(raw: string, type: BlockType): string {
  const text = raw.replace(/\r\n?/g, '\n');
  if (type === 'code') {
    return text.split(BR).join('\n').replace(/^\n+|\n+$/g, '');
  }
  // 源码里的换行只是排版，不是语义 → 折成空格；<br> 才是作者意图的分行 → 保留。
  let s = text.replace(/\n/g, ' ');
  s = s.replace(/[ \t\u00a0\u2000-\u200a]+/g, ' ').trim();
  return s
    .split(BR)
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function pushBlock(out: SourceBlock[], type: BlockType, raw: string): void {
  const text = normalizeText(raw, type);
  if (text) out.push({ type, text });
}

/** 把一个节点列表按块切开。 */
export function blocksFromNodes(nodes: Node[]): SourceBlock[] {
  const out: SourceBlock[] = [];
  let buf = '';

  const flush = (): void => {
    if (buf) pushBlock(out, 'para', buf);
    buf = '';
  };

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      buf += node.nodeValue ?? '';
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = node as Element;
    const tag = tagOf(el);
    if (SKIP.has(tag)) continue;

    if (tag === 'BR') {
      buf += BR;
      continue;
    }

    if (tag === 'TABLE') {
      flush();
      const rows = Array.from(el.querySelectorAll('tr'));
      for (const row of rows) {
        for (const cell of Array.from(row.children)) {
          const ct = tagOf(cell);
          if (ct !== 'TD' && ct !== 'TH') continue;
          flush();
          out.push(...blocksFromNodes(Array.from(cell.childNodes)));
        }
      }
      continue;
    }

    if (tag === 'UL' || tag === 'OL') {
      flush();
      for (const li of Array.from(el.children)) {
        if (tagOf(li) !== 'LI') continue;
        if (hasBlockChild(li)) out.push(...blocksFromNodes(Array.from(li.childNodes)));
        else pushBlock(out, 'list', textOf(li));
      }
      continue;
    }

    if (isBlockTag(tag)) {
      flush();
      if (CONTAINER.has(tag) && hasBlockChild(el)) {
        out.push(...blocksFromNodes(Array.from(el.childNodes)));
      } else {
        pushBlock(out, typeOf(tag), textOf(el));
      }
      continue;
    }

    // 行内元素：并进当前段落
    buf += textOf(el);
  }

  flush();
  return out;
}

export function blocksFromFragment(frag: DocumentFragment): SourceBlock[] {
  return blocksFromNodes(Array.from(frag.childNodes));
}

/**
 * 纯文本兜底：DOM 拿不到结构时（例如跨 shadow root 的选区），
 * 按空行切段；若全篇只有单换行，则把单换行也当段落边界。
 */
export function blocksFromPlainText(text: string): SourceBlock[] {
  const t = text.replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  let parts = t.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1 && (t.match(/\n/g)?.length ?? 0) >= 2) {
    parts = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  }
  return parts.map((p) => normalizeText(p, 'para')).filter(Boolean).map((p) => ({ type: 'para' as const, text: p }));
}

/** 当前选区 → 分块原文；没有有效选区返回 null。 */
export function extractSelection(): SelectionPayload | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  let blocks: SourceBlock[] = [];
  try {
    blocks = blocksFromFragment(range.cloneContents());
  } catch {
    blocks = [];
  }

  const text = sel.toString().trim();
  if (blocks.length === 0) blocks = blocksFromPlainText(text);
  if (blocks.length === 0) return null;

  return { blocks, text: text || blocks.map((b) => b.text).join('\n') };
}
