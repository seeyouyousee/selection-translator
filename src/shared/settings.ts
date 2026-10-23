/** 设置的读写与归一化（chrome.storage.local 单一键）。 */

import { DEFAULTS, STORAGE_KEY } from './types';
import type { Dims, DisplayMode, Pos, Settings, WindowPreset } from './types';
import { LANGS } from './lang';

const MODES: DisplayMode[] = ['bilingual', 'mono'];
const PRESETS: WindowPreset[] = ['sm', 'md', 'lg'];

function cleanDims(v: unknown): Dims | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { w?: unknown; h?: unknown };
  const w = Number(o.w);
  const h = Number(o.h);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < 260 || h < 200) return null;
  return { w: Math.round(w), h: Math.round(h) };
}

function cleanPos(v: unknown): Pos | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { x?: unknown; y?: unknown };
  const x = Number(o.x);
  const y = Number(o.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const merged = { ...DEFAULTS, ...(raw ?? {}) } as Settings;
  return {
    baseUrl: typeof merged.baseUrl === 'string' ? merged.baseUrl.trim() : DEFAULTS.baseUrl,
    apiKey: typeof merged.apiKey === 'string' ? merged.apiKey.trim() : '',
    model: typeof merged.model === 'string' && merged.model.trim() ? merged.model.trim() : DEFAULTS.model,
    targetLang: typeof merged.targetLang === 'string' && LANGS[merged.targetLang] ? merged.targetLang : DEFAULTS.targetLang,
    inputTargetLang:
      typeof merged.inputTargetLang === 'string' && LANGS[merged.inputTargetLang]
        ? merged.inputTargetLang
        : DEFAULTS.inputTargetLang,
    mode: MODES.includes(merged.mode) ? merged.mode : DEFAULTS.mode,
    disableThinking: merged.disableThinking !== false,
    windowPreset: PRESETS.includes(merged.windowPreset) ? merged.windowPreset : DEFAULTS.windowPreset,
    windowDims: cleanDims(merged.windowDims),
    windowPos: cleanPos(merged.windowPos),
  };
}

export async function loadSettings(): Promise<Settings> {
  const bag = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeSettings(bag?.[STORAGE_KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = normalizeSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}
