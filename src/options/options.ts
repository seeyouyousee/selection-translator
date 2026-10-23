/** 设置页逻辑：读写 chrome.storage，测试连接。 */

import { LANGS } from '../shared/lang';
import { loadSettings, normalizeSettings, saveSettings } from '../shared/settings';
import { call } from '../shared/messaging';
import type { DisplayMode, Settings, WindowPreset } from '../shared/types';

function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`设置页缺少元素 #${id}`);
  return node;
}

function setStatus(node: HTMLElement, text: string, kind?: 'ok' | 'err'): void {
  node.textContent = text;
  node.className = `status${kind ? ` ${kind}` : ''}`;
}

function fillLangSelect(id: string): void {
  const select = $(id) as HTMLSelectElement;
  select.replaceChildren();
  for (const [code, info] of Object.entries(LANGS)) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = info.name;
    select.appendChild(option);
  }
}

function checkRadio(name: string, value: string): void {
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`))) {
    input.checked = input.value === value;
  }
}

function readRadio(name: string): string {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return input?.value ?? '';
}

function normBaseUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

let loadedSettings: Settings | null = null;

function readForm(): Settings | null {
  const baseUrl = normBaseUrl(($('baseUrl') as HTMLInputElement).value);
  const apiKey = ($('apiKey') as HTMLInputElement).value.trim();
  const model = ($('model') as HTMLInputElement).value.trim();
  const targetLang = ($('targetLang') as HTMLSelectElement).value;
  const inputTargetLang = ($('inputTargetLang') as HTMLSelectElement).value;
  const mode = readRadio('mode') as DisplayMode;
  const preset = readRadio('preset') as WindowPreset;

  if (!baseUrl) {
    setStatus($('saveStatus'), '请填写 Base URL', 'err');
    ($('baseUrl') as HTMLInputElement).focus();
    return null;
  }
  if (!model) {
    setStatus($('saveStatus'), '请填写模型名', 'err');
    ($('model') as HTMLInputElement).focus();
    return null;
  }

  return normalizeSettings({
    ...(loadedSettings ?? {}),
    baseUrl,
    apiKey,
    model,
    targetLang: targetLang || 'zh',
    inputTargetLang: inputTargetLang || 'en',
    mode: mode === 'mono' ? 'mono' : 'bilingual',
    disableThinking: ($('disableThinking') as HTMLInputElement).checked,
    windowPreset: preset === 'sm' || preset === 'lg' ? preset : 'md',
  });
}

async function init(): Promise<void> {
  fillLangSelect('targetLang');
  fillLangSelect('inputTargetLang');
  const s = await loadSettings();
  loadedSettings = s;

  ($('baseUrl') as HTMLInputElement).value = s.baseUrl;
  ($('apiKey') as HTMLInputElement).value = s.apiKey;
  ($('model') as HTMLInputElement).value = s.model;
  ($('targetLang') as HTMLSelectElement).value = s.targetLang;
  ($('inputTargetLang') as HTMLSelectElement).value = s.inputTargetLang;
  ($('disableThinking') as HTMLInputElement).checked = s.disableThinking !== false;
  checkRadio('mode', s.mode);
  checkRadio('preset', s.windowPreset);

  $('toggleKey').addEventListener('click', () => {
    const input = $('apiKey') as HTMLInputElement;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('toggleKey').textContent = show ? '隐藏' : '显示';
  });

  $('saveBtn').addEventListener('click', () => {
    void onSave();
  });

  $('testBtn').addEventListener('click', () => {
    void onTest();
  });

  $('resetDims').addEventListener('click', () => {
    void onResetDims();
  });
}

async function onSave(): Promise<void> {
  const form = readForm();
  if (!form) return;

  const presetChanged = loadedSettings !== null && loadedSettings.windowPreset !== form.windowPreset;
  const patch: Partial<Settings> = {
    baseUrl: form.baseUrl,
    apiKey: form.apiKey,
    model: form.model,
    targetLang: form.targetLang,
    mode: form.mode,
    windowPreset: form.windowPreset,
  };
  if (presetChanged) {
    patch.windowDims = null;
    patch.windowPos = null;
  }

  const next = await saveSettings(patch);
  loadedSettings = next;
  setStatus($('saveStatus'), presetChanged ? '已保存，窗口将按新档位显示' : '已保存', 'ok');
  window.setTimeout(() => setStatus($('saveStatus'), ''), 2600);
}

async function onTest(): Promise<void> {
  const baseUrl = normBaseUrl(($('baseUrl') as HTMLInputElement).value);
  const apiKey = ($('apiKey') as HTMLInputElement).value.trim();
  const model = ($('model') as HTMLInputElement).value.trim();
  const status = $('testStatus');

  if (!baseUrl) {
    setStatus(status, '请先填写 Base URL', 'err');
    return;
  }
  if (!apiKey) {
    setStatus(status, '请先填写 API Key', 'err');
    return;
  }
  if (!model) {
    setStatus(status, '请先填写模型名', 'err');
    return;
  }

  setStatus(status, '测试中…');
  const res = await call({ type: 'st:test-connection', baseUrl, apiKey, model });
  if (!res.ok) {
    setStatus(status, res.error.message, 'err');
    return;
  }
  const sample = res.data.models.slice(0, 3).join('、');
  setStatus(
    status,
    `连接成功（HTTP ${res.data.status}）${sample ? `；可用模型：${sample}` : ''}`,
    'ok',
  );
}

async function onResetDims(): Promise<void> {
  const next = await saveSettings({ windowDims: null, windowPos: null });
  loadedSettings = next;
  setStatus($('saveStatus'), '已恢复默认窗口尺寸与位置', 'ok');
  window.setTimeout(() => setStatus($('saveStatus'), ''), 2600);
}

void init();
