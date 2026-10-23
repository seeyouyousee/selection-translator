/**
 * 内容脚本入口：监听选区 → 浮钮 → 翻译窗口。
 *
 * 数据流：
 *   选区 → extractSelection() 分出段落块 → detectLanguage() 判断是否已是目标语言
 *   → 是：本地规则切分后单语展示原文，不调 API
 *   → 否：段落块发给后台，由模型自己切句 + 翻译（校验不过则后台退回规则切分）
 */

import { STYLES } from '../content/ui/styles';
import { Fab } from '../content/ui/fab';
import { TranslatorWindow } from '../content/ui/window';
import { Toast } from '../content/ui/toast';
import { extractSelection } from '../content/extract';
import {
  isSupportedField,
  readFieldSelection,
  readRichSelection,
  replaceInputSelection,
} from '../content/input';
import type { InputSelection } from '../content/input';
import { segmentBlocks } from '../content/segment';
import { call } from '../shared/messaging';
import { MAX_CHARS } from '../shared/types';
import type { PublicConfig, Settings, SourceBlock, TranslateResult } from '../shared/types';
import { detectLanguage, sameLangFamily } from '../shared/lang';
import { saveSettings } from '../shared/settings';

const HOST_ID = 'st-translator-root';
const SELECTION_DEBOUNCE = 120;

interface PendingPayload {
  /** 原始段落块：切句交给后台（模型切，失败退回规则切） */
  blocks: SourceBlock[];
  text: string;
}

function mount(): { host: HTMLElement; shadow: ShadowRoot } | null {
  if (document.getElementById(HOST_ID)) return null;
  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);
  (document.documentElement ?? document.body).appendChild(host);
  return { host, shadow };
}

const mounted = mount();
if (mounted) start(mounted.shadow, mounted.host);

function start(shadow: ShadowRoot, host: HTMLElement): void {
  let pending: PendingPayload | null = null;
  let tooLong = false;
  let lastPayload: PendingPayload | null = null;
  let busy = false;
  /** 正在翻译/已翻译的选区文本：同一个选区不再重复弹浮钮。 */
  let activeText = '';
  let timer: number | null = null;

  /** 输入框里的选区（input/textarea/contenteditable） */
  let pendingInput: InputSelection | null = null;
  /** 最近聚焦的可编辑输入框；composedPath 能穿透 Shadow DOM */
  let lastField: HTMLInputElement | HTMLTextAreaElement | null = null;
  const toast = new Toast(shadow);

  const inHost = (node: Node | null): boolean => {
    if (!node) return false;
    const root = node.getRootNode();
    return root instanceof ShadowRoot && root.host === host;
  };

  const openOptions = (): void => {
    void call({ type: 'st:open-options' });
  };

  const persist = (patch: Partial<Settings>): void => {
    void saveSettings(patch).catch(() => undefined);
  };

  const win = new TranslatorWindow(shadow, {
    onModeChange: (mode) => persist({ mode }),
    onRetry: () => {
      if (lastPayload) void runTranslate(lastPayload);
    },
    onOpenOptions: openOptions,
    onSaveDims: (windowDims) => persist({ windowDims }),
    onSavePos: (windowPos) => persist({ windowPos }),
  });

  const fab = new Fab(shadow, () => {
    if (busy) return;

    // 输入框里的选区 → 翻译后原位替换
    if (pendingInput) {
      const target = pendingInput;
      pendingInput = null;
      void runInputTranslate(target);
      return;
    }

    const payload = pending;
    if (!payload) return;
    fab.hide();
    activeText = payload.text;
    void runTranslate(payload);
  });

  const hideFab = (): void => {
    fab.hide();
  };

  const selectionRect = (): DOMRect | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    const last = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!last || (last.width === 0 && last.height === 0)) return null;
    return last;
  };

  const lastRectOfRange = (range: Range): DOMRect | null => {
    const rects = range.getClientRects();
    const last = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!last || (last.width === 0 && last.height === 0)) return null;
    return last;
  };

  const handleSelection = (): void => {
    // 1) 输入框（input / textarea）里的选区：翻成「输入目标语言」并原位替换
    if (lastField && isSupportedField(lastField)) {
      const fieldSel = readFieldSelection(lastField);
      if (fieldSel) {
        pending = null;
        pendingInput = fieldSel;
        const rect = lastField.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          fab.showAt(rect);
          return;
        }
      } else {
        pending = null;
        pendingInput = null;
        hideFab();
      }
      return;
    }

    // 2) contenteditable 里的选区：同样走输入翻译
    const rich = readRichSelection();
    if (rich) {
      pending = null;
      pendingInput = rich;
      const rect = rich.range ? lastRectOfRange(rich.range) : null;
      if (rect) {
        fab.showAt(rect);
        return;
      }
    }

    pendingInput = null;

    // 3) 页面普通文字选区：原来的「对照翻译」逻辑
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || inHost(sel.anchorNode)) {
      pending = null;
      hideFab();
      return;
    }

    // 窗口正开着、且选区还是刚翻译过的那段 → 不再弹浮钮（不靠计时器，避免被浏览器节流）
    const currentText = sel.toString().trim();
    if (win.isOpen && currentText && currentText === activeText) {
      hideFab();
      return;
    }

    const extracted = extractSelection();
    if (!extracted) {
      pending = null;
      hideFab();
      return;
    }

    pending = { blocks: extracted.blocks, text: extracted.text };
    tooLong = extracted.text.length > MAX_CHARS;

    const rect = selectionRect();
    if (!rect) {
      hideFab();
      return;
    }
    fab.showAt(rect);
  };

  async function runInputTranslate(target: InputSelection): Promise<void> {
    if (busy) return;
    busy = true;
    fab.setBusy(true, '翻译中…');

    const res = await call({ type: 'st:translate-input', text: target.text });

    busy = false;
    fab.setBusy(false, '翻译');

    if (!res.ok) {
      fab.hide();
      toast.show(res.error.message, 'error', 5200);
      return;
    }

    if (res.data.sameLanguage) {
      fab.hide();
      toast.show('已是目标语言，无需翻译', 'info');
      return;
    }

    const ok = replaceInputSelection(target, res.data.tgt);
    fab.hide();
    if (!ok) {
      toast.show('替换失败：这个输入框不支持自动写入，请手动复制', 'error', 5200);
    }
    // 成功时静默替换，不弹提示
  }

  async function runTranslate(payload: PendingPayload): Promise<void> {
    if (busy) return;
    busy = true;
    lastPayload = payload;
    hideFab();

    const cfgRes = await call({ type: 'st:get-config' });
    if (!cfgRes.ok) {
      busy = false;
      win.open(fallbackConfig());
      win.showError(cfgRes.error.message, {
        label: '打开设置',
        primary: true,
        onClick: openOptions,
      });
      return;
    }

    const cfg = cfgRes.data;
    win.open(cfg);

    if (tooLong) {
      busy = false;
      win.showNotice(
        '选区太长',
        `选中的内容约 ${payload.text.length} 字，超过单次翻译上限 ${MAX_CHARS} 字。请分段选择后重试。`,
      );
      return;
    }

    if (!cfg.hasKey) {
      busy = false;
      win.showError('还没有配置 API Key，翻译服务无法调用。', {
        label: '去设置',
        primary: true,
        onClick: openOptions,
      });
      return;
    }

    const detected = detectLanguage(payload.text);
    if (sameLangFamily(detected, cfg.targetLang)) {
      busy = false;
      // 已是目标语言：本地规则切一下只为展示，不调 API
      const segmented = segmentBlocks(payload.blocks);
      const result: TranslateResult = {
        sourceLang: cfg.targetLang,
        targetLang: cfg.targetLang,
        sameLanguage: true,
        blocks: segmented.map((b) => ({
          type: b.type,
          pairs: b.units.map((s) => ({ src: s, tgt: s })),
        })),
      };
      win.showOriginal(result);
      return;
    }

    win.showLoading();
    const res = await call({ type: 'st:translate', blocks: payload.blocks, targetLang: cfg.targetLang });
    busy = false;

    if (!res.ok) {
      win.showError(res.error.message, {
        label: '重试',
        primary: true,
        onClick: () => {
          if (lastPayload) void runTranslate(lastPayload);
        },
      });
      return;
    }

    win.showResult(res.data);
  }

  /* ---------------- 事件接线 ---------------- */

  const scheduleSelection = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      handleSelection();
    }, SELECTION_DEBOUNCE);
  };

  const noteFocus = (event: FocusEvent): void => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const target = (path[0] ?? event.target) as Element | null;
    lastField = isSupportedField(target) ? target : null;
  };

  document.addEventListener('selectionchange', scheduleSelection, true);
  document.addEventListener('select', scheduleSelection, true);
  document.addEventListener('mouseup', scheduleSelection, true);
  document.addEventListener('keyup', scheduleSelection, true);
  document.addEventListener('input', scheduleSelection, true);
  document.addEventListener(
    'focusin',
    (event) => {
      noteFocus(event);
      scheduleSelection();
    },
    true,
  );
  document.addEventListener(
    'focusout',
    () => {
      window.setTimeout(() => {
        lastField = null;
      }, 180);
    },
    true,
  );

  document.addEventListener(
    'mousedown',
    (e) => {
      if (inHost(e.target as Node)) return;
      hideFab();
    },
    false,
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && win.isOpen) {
        win.close();
      }
    },
    true,
  );

  window.addEventListener('scroll', hideFab, { capture: true, passive: true });
  window.addEventListener('resize', hideFab);
}

function fallbackConfig(): PublicConfig {
  return {
    targetLang: 'zh',
    mode: 'bilingual',
    windowPreset: 'md',
    windowDims: null,
    windowPos: null,
    hasKey: false,
  };
}
