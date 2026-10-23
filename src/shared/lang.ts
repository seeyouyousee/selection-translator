/** 语言表 + 本地语言检测（不花 API，用于“选中的就是目标语言”短路）。 */

export interface LangInfo {
  /** 中文名，展示用 */
  name: string;
  /** 英文名，写进 prompt 用 */
  en: string;
}

export const LANGS: Record<string, LangInfo> = {
  zh: { name: '中文', en: 'Simplified Chinese' },
  'zh-TW': { name: '繁體中文', en: 'Traditional Chinese' },
  en: { name: '英语', en: 'English' },
  ja: { name: '日语', en: 'Japanese' },
  ko: { name: '韩语', en: 'Korean' },
  fr: { name: '法语', en: 'French' },
  de: { name: '德语', en: 'German' },
  es: { name: '西班牙语', en: 'Spanish' },
  pt: { name: '葡萄牙语', en: 'Portuguese' },
  it: { name: '意大利语', en: 'Italian' },
  ru: { name: '俄语', en: 'Russian' },
  ar: { name: '阿拉伯语', en: 'Arabic' },
};

export function langName(code: string): string {
  return LANGS[code]?.name ?? code.toUpperCase();
}

export function langEn(code: string): string {
  return LANGS[code]?.en ?? code;
}

/* ---------------- 字符脚本计数 ---------------- */

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const HIRA = /[\u3040-\u309f]/g;
const KATA = /[\u30a0-\u30ff\u31f0-\u31ff]/g;
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/g;
const CYRILLIC = /[\u0400-\u04ff]/g;
const ARABIC = /[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]/g;
const HEBREW = /[\u0590-\u05ff]/g;
const GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/g;
const THAI = /[\u0e00-\u0e7f]/g;
const DEVANAGARI = /[\u0900-\u097f]/g;
const LATIN = /[A-Za-z\u00c0-\u024f\u1e00-\u1eff]/g;

function count(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

/* ---------------- 拉丁语系判别用停用词 ---------------- */

const STOPWORDS: Record<string, string[]> = {
  en: [
    'the', 'and', 'of', 'to', 'in', 'is', 'that', 'it', 'for', 'was', 'with', 'as', 'on', 'are', 'be',
    'this', 'by', 'from', 'at', 'or', 'an', 'not', 'have', 'has', 'but', 'they', 'you', 'we', 'he',
    'she', 'i', 'his', 'her', 'their', 'which', 'what', 'when', 'there', 'been', 'will', 'would',
    'can', 'could', 'should', 'if', 'than', 'then', 'so', 'my', 'your', 'our', 'its', 'these',
    'those', 'do', 'does', 'did', 'more', 'most', 'such', 'into', 'about', 'after', 'before', 'over',
    'under', 'between', 'while', 'because', 'also', 'just', 'only', 'very', 'one', 'two', 'all',
  ],
  fr: [
    'le', 'la', 'les', 'des', 'et', 'est', 'un', 'une', 'du', 'de', 'en', 'que', 'qui', 'dans',
    'pour', 'pas', 'au', 'aux', 'ce', 'cette', 'ces', 'il', 'elle', 'nous', 'vous', 'ils', 'elles',
    'sont', 'être', 'avoir', 'avec', 'sur', 'par', 'plus', 'mais', 'ou', 'comme', 'tout', 'tous',
    'toute', 'leur', 'leurs', 'ne', 'se', 'sa', 'son', 'ses', 'on', 'été', 'fait', 'aussi', 'très',
  ],
  de: [
    'der', 'die', 'das', 'und', 'ist', 'ein', 'eine', 'nicht', 'mit', 'sich', 'auf', 'für', 'von',
    'den', 'dem', 'des', 'zu', 'im', 'in', 'als', 'auch', 'werden', 'wird', 'sind', 'hat', 'haben',
    'dass', 'es', 'er', 'sie', 'wir', 'ich', 'du', 'aber', 'oder', 'wenn', 'wie', 'bei', 'nach',
    'über', 'noch', 'nur', 'schon', 'kann', 'muss', 'sehr', 'mehr', 'einer', 'eines',
  ],
  es: [
    'el', 'la', 'los', 'las', 'de', 'del', 'y', 'que', 'en', 'un', 'una', 'es', 'por', 'para',
    'con', 'no', 'se', 'su', 'sus', 'al', 'lo', 'como', 'más', 'pero', 'si', 'o', 'este', 'esta',
    'estos', 'estas', 'son', 'fue', 'hay', 'muy', 'también', 'porque', 'cuando', 'donde', 'todo',
    'todos', 'tiene', 'han', 'fue', 'era', 'ser', 'estar', 'entre', 'sobre',
  ],
  pt: [
    'o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'e', 'que', 'em', 'um', 'uma', 'é',
    'por', 'para', 'com', 'não', 'se', 'seu', 'sua', 'ao', 'mais', 'mas', 'como', 'ou', 'este',
    'esta', 'são', 'foi', 'há', 'muito', 'também', 'porque', 'quando', 'onde', 'todo', 'todos',
    'tem', 'entre', 'sobre', 'pelo', 'pela',
  ],
  it: [
    'il', 'lo', 'la', 'i', 'gli', 'le', 'di', 'del', 'della', 'e', 'che', 'in', 'un', 'una', 'è',
    'per', 'con', 'non', 'si', 'suo', 'sua', 'al', 'più', 'ma', 'come', 'o', 'questo', 'questa',
    'sono', 'era', 'ha', 'hanno', 'molto', 'anche', 'perché', 'quando', 'dove', 'tutto', 'tutti',
    'tra', 'sul', 'nel',
  ],
};

const TOKEN = /[a-z\u00c0-\u024f]+(?:['’][a-z]+)?/g;

function guessLatin(text: string): string | null {
  const tokens = text.toLowerCase().match(TOKEN) ?? [];
  if (tokens.length < 3) return null;
  const scores: Array<[string, number]> = [];
  for (const [code, words] of Object.entries(STOPWORDS)) {
    const set = new Set(words);
    let hits = 0;
    for (const t of tokens) if (set.has(t)) hits += 1;
    scores.push([code, hits / tokens.length]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  const top = scores[0];
  if (!top) return null;
  const second = scores[1]?.[1] ?? 0;
  if (top[1] >= 0.15 && top[1] - second >= 0.04) return top[0];
  return null;
}

/**
 * 粗粒度语言识别。返回 ISO 639-1 代码，识别不出返回 null。
 *
 * 设计取舍：这里只服务一个判断——“是不是已经是目标语言”。
 * 判不准时**宁可返回 null**（走翻译），也不要猜错把外文当原文直接展示。
 */
export function detectLanguage(raw: string): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ');

  const han = count(text, HAN);
  const kana = count(text, HIRA) + count(text, KATA);
  const hangul = count(text, HANGUL);
  const cyrillic = count(text, CYRILLIC);
  const arabic = count(text, ARABIC);
  const hebrew = count(text, HEBREW);
  const greek = count(text, GREEK);
  const thai = count(text, THAI);
  const deva = count(text, DEVANAGARI);
  const latin = count(text, LATIN);
  const total = han + kana + hangul + cyrillic + arabic + hebrew + greek + thai + deva + latin;

  if (total < 2) return null;

  if (hangul / total >= 0.3) return 'ko';
  if (kana > 0 && kana / (kana + han) >= 0.08) return 'ja';
  if (han / total >= 0.4) return 'zh';
  if (cyrillic / total >= 0.5) return 'ru';
  if (arabic / total >= 0.5) return 'ar';
  if (hebrew / total >= 0.5) return 'he';
  if (greek / total >= 0.5) return 'el';
  if (thai / total >= 0.5) return 'th';
  if (deva / total >= 0.5) return 'hi';
  if (latin / total >= 0.5) return guessLatin(text);
  return null;
}

/** 两个语言代码是否视为同一种语言（简体/繁体中文互相算同一种）。 */
export function sameLangFamily(a: string | null, b: string): boolean {
  if (!a) return false;
  if (a === b) return true;
  if (a.startsWith('zh') && b.startsWith('zh')) return true;
  return false;
}
