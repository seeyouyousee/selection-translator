/**
 * 窗口与浮钮的全部样式，注入 Shadow Root，站点 CSS 进不来。
 * 配色跟随系统的浅色/深色。
 */

export const STYLES = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;

  --st-bg: #ffffff;
  --st-fg: #1f2328;
  --st-src: #24292f;
  --st-tgt: #3d4a5c;
  --st-muted: #6b7280;
  --st-border: #e4e7eb;
  --st-head-bg: #fafbfc;
  --st-seg-bg: #eef1f4;
  --st-hover: #f0f2f5;
  --st-accent: #2563eb;
  --st-accent-weak: #93b4f5;
  --st-accent-soft: rgba(37, 99, 235, 0.10);
  --st-code-bg: #f6f8fa;
  --st-danger: #c0392b;
  --st-shadow: 0 16px 48px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);

  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: 14px;
  color: var(--st-fg);
}

@media (prefers-color-scheme: dark) {
  :host {
    --st-bg: #1c1f24;
    --st-fg: #e6e9ee;
    --st-src: #e6e9ee;
    --st-tgt: #c3cbd6;
    --st-muted: #98a2b3;
    --st-border: #333a44;
    --st-head-bg: #22262c;
    --st-seg-bg: #2b3038;
    --st-hover: #2a2f37;
    --st-accent: #60a5fa;
    --st-accent-weak: #3b5f96;
    --st-accent-soft: rgba(96, 165, 250, 0.14);
    --st-code-bg: #262b33;
    --st-danger: #f87171;
    --st-shadow: 0 16px 48px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35);
  }
}

* { box-sizing: border-box; }

/* ---------------- 浮钮 ---------------- */

.st-fab {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px 0 9px;
  border: 0;
  border-radius: 999px;
  background: var(--st-accent);
  color: #fff;
  font: 600 12.5px/1 inherit;
  font-family: inherit;
  box-shadow: 0 4px 16px rgba(37, 99, 235, 0.38);
  cursor: pointer;
  pointer-events: auto;
  white-space: nowrap;
  transition: transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease;
}
.st-fab:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(37, 99, 235, 0.46); }
.st-fab:active { transform: translateY(0); }
.st-fab[disabled] { opacity: 0.72; cursor: default; transform: none; }
.st-fab[hidden] { display: none; }
.st-fab-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  font-size: 11px;
  font-weight: 700;
}

/* ---------------- 窗口 ---------------- */

.st-panel {
  position: fixed;
  display: flex;
  flex-direction: column;
  min-width: 320px;
  min-height: 240px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  background: var(--st-bg);
  color: var(--st-fg);
  border: 1px solid var(--st-border);
  border-radius: 12px;
  box-shadow: var(--st-shadow);
  overflow: hidden;
  resize: both;
  pointer-events: auto;
}
.st-panel[hidden] { display: none; }

.st-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 8px 8px 8px 14px;
  background: var(--st-head-bg);
  border-bottom: 1px solid var(--st-border);
  cursor: grab;
  user-select: none;
}
.st-panel.st-dragging .st-head { cursor: grabbing; }

.st-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--st-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.st-seg {
  display: inline-flex;
  flex: 0 0 auto;
  padding: 2px;
  background: var(--st-seg-bg);
  border-radius: 8px;
}
.st-seg[hidden] { display: none; }
.st-seg-btn {
  border: 0;
  background: transparent;
  color: var(--st-muted);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 5px 9px;
  border-radius: 6px;
  cursor: pointer;
}
.st-seg-btn[aria-pressed="true"] {
  background: var(--st-bg);
  color: var(--st-fg);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.14);
}

.st-close {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--st-muted);
  font: 400 20px/1 inherit;
  font-family: inherit;
  cursor: pointer;
}
.st-close:hover { background: var(--st-hover); border-color: var(--st-border); color: var(--st-fg); }

.st-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 18px 20px;
  overscroll-behavior: contain;
}
.st-body::-webkit-scrollbar { width: 10px; }
.st-body::-webkit-scrollbar-thumb {
  background: var(--st-border);
  border-radius: 6px;
  border: 3px solid transparent;
  background-clip: content-box;
}
.st-body::-webkit-scrollbar-thumb:hover { background: var(--st-muted); background-clip: content-box; }

/* ---------------- 底部操作栏 ---------------- */

.st-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border-top: 1px solid var(--st-border);
  background: var(--st-head-bg);
}

.st-foot-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  font: inherit;
  font-size: 12.5px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
}
.st-foot-btn:focus-visible,
.st-close:focus-visible,
.st-fab:focus-visible {
  outline: 2px solid var(--st-accent);
  outline-offset: 2px;
}

.st-foot-ghost {
  border: 1px solid var(--st-border);
  background: var(--st-bg);
  color: var(--st-fg);
}
.st-foot-ghost:hover { background: var(--st-hover); }

.st-foot-primary {
  /* 拉长：吃掉底栏剩余宽度，做成一条好点的大按钮 */
  flex: 1 1 auto;
  min-width: 120px;
  border: 0;
  background: var(--st-fg);
  color: var(--st-bg);
  font-weight: 600;
}
.st-foot-primary:hover { filter: brightness(0.92); }
@media (prefers-color-scheme: dark) {
  .st-foot-primary:hover { filter: brightness(1.15); }
}

/* ---------------- 对照内容 ---------------- */

.st-block { margin: 0 0 22px; }
.st-block:last-child { margin-bottom: 0; }

/* 逐句对照：一对 = 一句原文 + 它的译文，对与对之间留呼吸感 */
.st-pair { margin: 0 0 12px; }
.st-pair:last-child { margin-bottom: 0; }

.st-src,
.st-tgt {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.78;
}

.st-src { color: var(--st-src); font-size: 14.5px; }
.st-tgt { color: var(--st-tgt); font-size: 14.5px; }

/* 双语：每句译文紧跟该句原文，用左侧细线 + 淡底区分，原文为主、译文为辅 */
.st-bilingual .st-tgt {
  margin-top: 4px;
  padding: 2px 0 2px 12px;
  border-left: 3px solid var(--st-accent-weak);
  background: linear-gradient(90deg, var(--st-accent-soft), transparent 42%);
  border-radius: 0 6px 6px 0;
}

/* 单语：译文就是正文，按正常阅读排版 */
.st-mono .st-tgt { color: var(--st-fg); font-size: 15px; }

.st-heading { font-size: 17px; font-weight: 700; line-height: 1.55; }
.st-tgt.st-heading { font-size: 16.5px; }

.st-quote {
  font-style: italic;
  color: var(--st-muted);
  padding-left: 10px;
  border-left: 3px solid var(--st-border);
}
.st-bilingual .st-tgt.st-quote { border-left: 3px solid var(--st-accent-weak); }

.st-list { position: relative; padding-left: 16px; }
.st-list::before {
  content: "•";
  position: absolute;
  left: 2px;
  color: var(--st-muted);
}

.st-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12.5px;
  line-height: 1.6;
  background: var(--st-code-bg);
  border: 1px solid var(--st-border);
  border-radius: 8px;
  padding: 10px 12px;
  white-space: pre;
  overflow-x: auto;
}
.st-bilingual .st-tgt.st-code { border-left: 3px solid var(--st-accent-weak); }

/* ---------------- 轻提示 ---------------- */

.st-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  max-width: min(560px, calc(100vw - 32px));
  padding: 9px 14px;
  border-radius: 9px;
  background: rgba(24, 28, 35, 0.94);
  color: #fff;
  font-size: 12.5px;
  line-height: 1.5;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  pointer-events: none;
  z-index: 2147483647;
}
.st-toast[hidden] { display: none; }
.st-toast-error { background: #b42318; }

/* ---------------- 状态：加载 / 错误 / 提示 ---------------- */

.st-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 200px;
  padding: 28px 8px;
  text-align: center;
  color: var(--st-muted);
  font-size: 13px;
  line-height: 1.7;
}

.st-spinner {
  width: 22px;
  height: 22px;
  border: 2.5px solid var(--st-border);
  border-top-color: var(--st-accent);
  border-radius: 50%;
  animation: st-spin 0.8s linear infinite;
}
@keyframes st-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .st-spinner { animation-duration: 2.4s; }
}

.st-state-title { color: var(--st-fg); font-size: 13.5px; font-weight: 600; }
.st-state-msg { max-width: 340px; }
.st-state-msg.st-error { color: var(--st-danger); }

.st-btn {
  border: 1px solid var(--st-border);
  background: var(--st-bg);
  color: var(--st-fg);
  font: inherit;
  font-size: 12.5px;
  padding: 6px 14px;
  border-radius: 7px;
  cursor: pointer;
}
.st-btn:hover { background: var(--st-hover); }
.st-btn-primary {
  border-color: transparent;
  background: var(--st-accent);
  color: #fff;
}
.st-btn-primary:hover { filter: brightness(1.06); background: var(--st-accent); }

.st-note {
  font-size: 12px;
  color: var(--st-muted);
  text-align: center;
  padding: 2px 0 4px;
}
`;
