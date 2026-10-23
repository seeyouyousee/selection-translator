/** 全局共享的类型与常量。内容脚本、后台、设置页三方共用。 */

export type DisplayMode = 'bilingual' | 'mono';
export type WindowPreset = 'sm' | 'md' | 'lg';
export type BlockType = 'heading' | 'para' | 'list' | 'quote' | 'code';

/** 从选区里提出来的一块原文（段落 / 标题 / 列表项 / 引用 / 代码）。 */
export interface SourceBlock {
  type: BlockType;
  text: string;
}

/**
 * 段落块切好的翻译单元：通常是一整句；超长句会再切成若干分句。
 * 段落只是分组单位。
 */
export interface SegmentBlock {
  type: BlockType;
  /** 整段原文：一起发给模型当上下文 */
  text: string;
  /** 本地切好的翻译单元：模型按这个粒度一条对一个 */
  units: string[];
}

/** 一组对照：一句原文 + 它自己的译文。双语模式按这个单位逐句排。 */
export interface SentencePair {
  src: string;
  tgt: string;
}

/** 一个段落块，内部是逐句对照。 */
export interface TransBlock {
  type: BlockType;
  pairs: SentencePair[];
}

/** 输入框翻译：纯文本进、纯文本出，不需要对照结构。 */
export interface InputTranslateResult {
  tgt: string;
  sourceLang: string;
  sameLanguage: boolean;
}

export interface TranslateResult {
  sourceLang: string;
  targetLang: string;
  /** 原文本来就是目标语言时 true；此时 blocks 的 src === tgt，且不应调用 API。 */
  sameLanguage: boolean;
  blocks: TransBlock[];
}

export interface Dims {
  w: number;
  h: number;
}

export interface Pos {
  x: number;
  y: number;
}

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  targetLang: string;
  /** 输入目标语言：翻译输入框里选中的文字时用 */
  inputTargetLang: string;
  /** 上次使用的展示模式，同时也是设置页里的“默认模式”。 */
  mode: DisplayMode;
  /** 请求里显式发送「关闭思考」参数（reasoning_effort / enable_thinking / thinking）。 */
  disableThinking: boolean;
  windowPreset: WindowPreset;
  /** 用户手动拖拽过窗口后记住的尺寸；为 null 时用 windowPreset。 */
  windowDims: Dims | null;
  /** 上次窗口位置；为 null 时居中。 */
  windowPos: Pos | null;
}

/** 内容脚本能看到的配置（不含 apiKey）。 */
export interface PublicConfig {
  targetLang: string;
  mode: DisplayMode;
  windowPreset: WindowPreset;
  windowDims: Dims | null;
  windowPos: Pos | null;
  hasKey: boolean;
}

export const STORAGE_KEY = 'settings';

/** 单次翻译的原文上限（字符）。超过时不发请求，只给提示。 */
export const MAX_CHARS = 8000;
export const MAX_BLOCKS = 200;
export const MAX_SENTENCES = 400;

export const PRESETS: Record<WindowPreset, Dims> = {
  sm: { w: 420, h: 420 },
  md: { w: 520, h: 560 },
  lg: { w: 680, h: 720 },
};

export const DEFAULTS: Settings = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  targetLang: 'zh',
  inputTargetLang: 'en',
  mode: 'bilingual',
  disableThinking: true,
  windowPreset: 'md',
  windowDims: null,
  windowPos: null,
};

export interface ApiOk<T> {
  ok: true;
  data: T;
}
export interface ApiErr {
  ok: false;
  error: { code: string; message: string };
}
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}
