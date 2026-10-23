/**
 * 输入框里的“选中文字 → 翻译 → 原位替换”。
 *
 * 覆盖两类可编辑区域：
 *  - input[type=text/search/email/url/tel] 与 textarea：用 selectionStart/End；
 *  - contenteditable：用 window.getSelection() 的 Range。
 *
 * 写回优先用 document.execCommand('insertText')：它会触发原生 input 事件，
 * React/Vue 受控组件能收到，而且保留浏览器撤销栈（Ctrl+Z 可回退）。
 */

export interface InputSelection {
  kind: 'field' | 'rich';
  text: string;
  element: HTMLElement;
  /** field：选区起点/终点 */
  start?: number;
  end?: number;
  /** rich：克隆下来的 Range，防止点击按钮后选区丢失 */
  range?: Range;
}

const FIELD_TYPES = new Set(['text', 'search', 'email', 'url', 'tel']);

export function isSupportedField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return FIELD_TYPES.has(el.type) && !el.disabled && !el.readOnly;
  }
  return false;
}

/** 从已聚焦的输入框里读当前选区；没有选中内容返回 null。 */
export function readFieldSelection(
  el: HTMLInputElement | HTMLTextAreaElement,
): InputSelection | null {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start === null || end === null || end <= start) return null;
  const text = el.value.slice(start, end);
  if (!text.trim()) return null;
  return { kind: 'field', text, element: el, start, end };
}

function closestEditable(node: Node | null): HTMLElement | null {
  let el: Element | null = node instanceof Element ? node : (node?.parentElement ?? null);
  while (el) {
    if (el instanceof HTMLElement && el.isContentEditable) return el;
    el = el.parentElement;
  }
  return null;
}

/** 页面选区是否落在某个 contenteditable 里。 */
export function readRichSelection(): InputSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  const host = closestEditable(range.commonAncestorContainer);
  if (!host) return null;

  const text = sel.toString();
  if (!text.trim()) return null;

  return { kind: 'rich', text, element: host, range: range.cloneRange() };
}

/** 用译文替换当时的选区。成功返回 true。 */
export function replaceInputSelection(target: InputSelection, text: string): boolean {
  if (target.kind === 'field') {
    const input = target.element as HTMLInputElement | HTMLTextAreaElement;
    input.focus();
    try {
      input.setSelectionRange(target.start ?? 0, target.end ?? 0);
    } catch {
      /* 某些 input 类型不支持 setSelectionRange */
    }
    if (execInsert(text)) return true;

    // 兜底：直接改 value 并派发 input/change（受控组件可能仍不认，但值是对的）
    const value = input.value;
    const start = target.start ?? 0;
    const end = target.end ?? start;
    input.value = value.slice(0, start) + text + value.slice(end);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // contenteditable
  target.element.focus();
  if (target.range && target.range.startContainer.isConnected) {
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(target.range);
    }
  }
  if (execInsert(text)) return true;

  // 兜底：删掉旧内容，插入文本节点
  try {
    const range = target.range;
    if (!range) return false;
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    target.element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

function execInsert(text: string): boolean {
  try {
    return document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}
