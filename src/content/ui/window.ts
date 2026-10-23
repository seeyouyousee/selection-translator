/**
 * 翻译窗口。
 *
 * 双语对照**逐单元**排：一句原文（或长句切出的分句），紧跟它自己的译文，再下一个单元。
 * 段落只作分组与留白。双语/单语共用同一份句对数据，切换只是重排。
 */

import type { BlockType, Dims, DisplayMode, Pos, PublicConfig, TranslateResult } from '../../shared/types';
import { PRESETS } from '../../shared/types';
import { langName } from '../../shared/lang';

export interface WindowDeps {
  onModeChange: (mode: DisplayMode) => void;
  onRetry: () => void;
  onOpenOptions: () => void;
  onSaveDims: (dims: Dims) => void;
  onSavePos: (pos: Pos) => void;
}

type Phase = 'idle' | 'loading' | 'result' | 'error' | 'notice';

interface ActionButton {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

const MIN_VISIBLE = 8;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class TranslatorWindow {
  private readonly panel: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly seg: HTMLDivElement;
  private readonly segBi: HTMLButtonElement;
  private readonly segMono: HTMLButtonElement;
  private readonly body: HTMLDivElement;

  private readonly deps: WindowDeps;

  private phase: Phase = 'idle';
  private mode: DisplayMode = 'bilingual';
  private config: PublicConfig | null = null;
  private result: TranslateResult | null = null;

  private expected: Dims | null = null;
  private dimTimer: number | null = null;
  private readonly ro: ResizeObserver;

  constructor(root: ShadowRoot, deps: WindowDeps) {
    this.deps = deps;

    this.panel = el('div', 'st-panel');
    this.panel.hidden = true;
    this.panel.tabIndex = -1;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', '翻译结果');

    const head = el('div', 'st-head');

    this.title = el('div', 'st-title', '翻译');

    this.seg = el('div', 'st-seg');
    this.segBi = el('button', 'st-seg-btn', '双语');
    this.segMono = el('button', 'st-seg-btn', '单语');
    for (const btn of [this.segBi, this.segMono]) {
      btn.type = 'button';
      this.seg.appendChild(btn);
    }
    this.segBi.addEventListener('click', () => this.setMode('bilingual'));
    this.segMono.addEventListener('click', () => this.setMode('mono'));

    const close = el('button', 'st-close', '×');
    close.type = 'button';
    close.title = '关闭（Esc）';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', () => this.close());

    head.append(this.title, this.seg, close);

    this.body = el('div', 'st-body st-bilingual');

    // 底部常驻操作栏：设置入口 + 大号关闭（看完内容后手指/视线正好在这一带）
    const foot = el('div', 'st-foot');
    const settingsBtn = el('button', 'st-foot-btn st-foot-ghost', '⚙ 设置');
    settingsBtn.type = 'button';
    settingsBtn.title = '打开扩展设置';
    settingsBtn.addEventListener('click', () => this.deps.onOpenOptions());

    const closeBtn = el('button', 'st-foot-btn st-foot-primary', '关闭');
    closeBtn.type = 'button';
    closeBtn.title = '关闭（Esc）';
    closeBtn.addEventListener('click', () => this.close());

    foot.append(settingsBtn, closeBtn);

    this.panel.append(head, this.body, foot);
    root.appendChild(this.panel);

    this.bindDrag(head);
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(this.panel);
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  /** 打开窗口并进入 loading。 */
  open(config: PublicConfig): void {
    this.config = config;
    this.mode = config.mode;
    this.result = null;
    this.phase = 'loading';

    this.applyGeometry(config);
    this.panel.hidden = false;
    this.title.textContent = '翻译中…';
    this.updateSeg();
    this.renderState();
  }

  showLoading(): void {
    this.phase = 'loading';
    this.title.textContent = '翻译中…';
    this.renderState();
  }

  /** 原文就是目标语言：不调 API，直接按单语展示原文。 */
  showOriginal(result: TranslateResult): void {
    this.result = result;
    this.mode = 'mono';
    this.phase = 'result';
    this.title.textContent = `${langName(result.targetLang)} · 已是目标语言，无需翻译`;
    this.updateSeg();
    this.renderResult();
  }

  showResult(result: TranslateResult): void {
    this.result = result;
    this.phase = 'result';
    this.mode = result.sameLanguage ? 'mono' : (this.config?.mode ?? this.mode);
    const src = result.sourceLang ? langName(result.sourceLang) : '原文';
    this.title.textContent = `${src} → ${langName(result.targetLang)}`;
    this.updateSeg();
    this.renderResult();
  }

  showError(message: string, action?: ActionButton): void {
    this.phase = 'error';
    this.title.textContent = '翻译失败';
    this.updateSeg();
    this.renderState(message, action);
  }

  showNotice(title: string, message: string, action?: ActionButton): void {
    this.phase = 'notice';
    this.title.textContent = title;
    this.updateSeg();
    this.renderState(message, action);
  }

  close(): void {
    this.phase = 'idle';
    this.result = null;
    this.panel.hidden = true;
    this.body.replaceChildren();
  }

  private setMode(mode: DisplayMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.deps.onModeChange(mode);
    this.updateSeg();
    if (this.phase === 'result') this.renderResult();
  }

  private updateSeg(): void {
    const same = this.result?.sameLanguage === true;
    this.seg.hidden = same || this.phase !== 'result';
    this.segBi.setAttribute('aria-pressed', String(this.mode === 'bilingual'));
    this.segMono.setAttribute('aria-pressed', String(this.mode === 'mono'));
  }

  private renderState(message?: string, action?: ActionButton): void {
    this.body.className = 'st-body st-mono';
    this.body.replaceChildren();

    const box = el('div', 'st-state');

    if (this.phase === 'loading') {
      box.appendChild(el('div', 'st-spinner'));
      box.appendChild(el('div', 'st-state-msg', '正在翻译…'));
      this.body.appendChild(box);
      return;
    }

    const title =
      this.phase === 'error' ? '没能完成翻译' : this.phase === 'notice' ? '提示' : '';
    if (title) box.appendChild(el('div', 'st-state-title', title));
    if (message) box.appendChild(el('div', 'st-state-msg st-error', message));

    if (action) {
      const btn = el('button', `st-btn${action.primary ? ' st-btn-primary' : ''}`, action.label);
      btn.type = 'button';
      btn.addEventListener('click', action.onClick);
      box.appendChild(btn);
    }

    this.body.appendChild(box);
  }

  private renderResult(): void {
    if (!this.result) return;
    const bilingual = this.mode === 'bilingual' && !this.result.sameLanguage;
    this.body.className = `st-body ${bilingual ? 'st-bilingual' : 'st-mono'}`;
    this.body.replaceChildren();

    for (const block of this.result.blocks) {
      const wrap = el('div', 'st-block');
      if (bilingual) {
        // 逐句对照：一句原文，紧跟它的译文；再下一句
        for (const pair of block.pairs) {
          const row = el('div', 'st-pair');
          row.appendChild(textEl('src', block.type, pair.src));
          row.appendChild(textEl('tgt', block.type, pair.tgt));
          wrap.appendChild(row);
        }
      } else {
        // 单语：把这一段的译文按句拼回正文
        const text = joinSentences(
          block.pairs.map((p) => p.tgt),
          this.result.targetLang,
        );
        wrap.appendChild(textEl('tgt', block.type, text));
      }
      this.body.appendChild(wrap);
    }
  }

  /* ---------------- 尺寸 / 位置 ---------------- */

  private applyGeometry(config: PublicConfig): void {
    const preset = PRESETS[config.windowPreset] ?? PRESETS.md;
    const dims = config.windowDims ?? preset;
    const w = Math.round(clamp(dims.w, 320, window.innerWidth - 16));
    const h = Math.round(clamp(dims.h, 240, window.innerHeight - 16));

    this.panel.style.width = `${w}px`;
    this.panel.style.height = `${h}px`;

    const pos = config.windowPos ?? {
      x: Math.round((window.innerWidth - w) / 2),
      y: Math.round((window.innerHeight - h) / 2),
    };
    const x = Math.round(clamp(pos.x, MIN_VISIBLE, window.innerWidth - w - MIN_VISIBLE));
    const y = Math.round(clamp(pos.y, MIN_VISIBLE, window.innerHeight - h - MIN_VISIBLE));
    this.panel.style.left = `${x}px`;
    this.panel.style.top = `${y}px`;

    this.expected = { w, h };
  }

  private onResize(): void {
    const w = this.panel.offsetWidth;
    const h = this.panel.offsetHeight;
    if (w < 100 || h < 100) return;
    if (this.expected && this.expected.w === w && this.expected.h === h) return;
    this.expected = null;
    if (this.dimTimer !== null) window.clearTimeout(this.dimTimer);
    this.dimTimer = window.setTimeout(() => {
      this.dimTimer = null;
      if (!this.isOpen) return;
      this.deps.onSaveDims({ w: this.panel.offsetWidth, h: this.panel.offsetHeight });
    }, 450);
  }

  private bindDrag(head: HTMLElement): void {
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;

    head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      ox = this.panel.offsetLeft;
      oy = this.panel.offsetTop;
      this.panel.classList.add('st-dragging');
      try {
        head.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    });

    head.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const w = this.panel.offsetWidth;
      const h = this.panel.offsetHeight;
      const x = clamp(ox + e.clientX - sx, MIN_VISIBLE, window.innerWidth - w - MIN_VISIBLE);
      const y = clamp(oy + e.clientY - sy, MIN_VISIBLE, window.innerHeight - h - MIN_VISIBLE);
      this.panel.style.left = `${Math.round(x)}px`;
      this.panel.style.top = `${Math.round(y)}px`;
    });

    const stop = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      this.panel.classList.remove('st-dragging');
      try {
        head.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      this.deps.onSavePos({ x: this.panel.offsetLeft, y: this.panel.offsetTop });
    };
    head.addEventListener('pointerup', stop);
    head.addEventListener('pointercancel', stop);
  }
}

function textEl(kind: 'src' | 'tgt', type: BlockType, text: string): HTMLDivElement {
  const cls = `st-${kind}${type === 'para' ? '' : ` st-${type}`}`;
  const node = el('div', cls);
  node.textContent = text;
  return node;
}

const NO_SPACE_JOIN = new Set(['zh', 'zh-TW', 'ja']);

/** 单语模式把逐句译文拼回一段：中日文句尾自带标点，不加空格；其它语言加空格。 */
function joinSentences(sentences: string[], targetLang: string): string {
  const sep = NO_SPACE_JOIN.has(targetLang) ? '' : ' ';
  return sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .join(sep);
}
