/** 轻量提示条：输入框翻译的错误、或“已是目标语言”这类短提示。 */

export class Toast {
  private readonly el: HTMLDivElement;
  private timer: number | null = null;

  constructor(root: ShadowRoot) {
    this.el = document.createElement('div');
    this.el.className = 'st-toast';
    this.el.hidden = true;
    root.appendChild(this.el);
  }

  show(message: string, kind: 'info' | 'error' = 'info', ms = 4200): void {
    this.el.textContent = message;
    this.el.className = `st-toast${kind === 'error' ? ' st-toast-error' : ''}`;
    this.el.hidden = false;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.el.hidden = true;
    }, ms);
  }

  hide(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.el.hidden = true;
  }
}
