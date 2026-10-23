/** 选区旁的“翻译”浮钮。只负责出现、定位、点击回调。 */

export class Fab {
  private readonly el: HTMLButtonElement;
  private readonly label: HTMLSpanElement;

  constructor(root: ShadowRoot, onClick: () => void) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'st-fab';
    btn.hidden = true;
    btn.title = '翻译选中内容';

    const glyph = document.createElement('span');
    glyph.className = 'st-fab-glyph';
    glyph.textContent = '译';

    const label = document.createElement('span');
    label.textContent = '翻译';

    btn.append(glyph, label);
    this.label = label;

    // mousedown 默认会清掉选区 → 必须拦掉，否则点击时原文已经没了
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    btn.addEventListener('mouseup', (e) => e.stopPropagation());

    root.appendChild(btn);
    this.el = btn;
  }

  showAt(rect: DOMRect): void {
    this.el.hidden = false;
    const pad = 8;
    const w = this.el.offsetWidth || 78;
    const h = this.el.offsetHeight || 30;

    let left = rect.right + pad;
    let top = rect.bottom + pad;

    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (top + h > window.innerHeight - pad) top = rect.top - h - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;

    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  hide(): void {
    this.el.hidden = true;
  }

  setLabel(text: string): void {
    this.label.textContent = text;
  }

  /** 翻译中：文案换掉、禁用点击，避免重复触发 */
  setBusy(busy: boolean, label?: string): void {
    this.el.disabled = busy;
    this.el.classList.toggle('st-fab-busy', busy);
    if (label !== undefined) this.label.textContent = label;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }
}
