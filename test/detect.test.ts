import { describe, expect, it } from 'vitest';
import { detectLanguage, sameLangFamily } from '../src/shared/lang';

describe('detectLanguage', () => {
  it('识别中文', () => {
    expect(detectLanguage('这是一个用来测试的中文句子。')).toBe('zh');
  });

  it('中文里夹英文术语仍判中文', () => {
    expect(detectLanguage('我们用 Shadow DOM 隔离样式，页面不会被污染。')).toBe('zh');
  });

  it('短中文也认得出', () => {
    expect(detectLanguage('你好')).toBe('zh');
  });

  it('识别英文', () => {
    expect(detectLanguage('The quick brown fox jumps over the lazy dog and it was quiet.')).toBe('en');
  });

  it('识别法语', () => {
    expect(
      detectLanguage("C'est une très bonne idée que nous avons eue hier soir avec les enfants."),
    ).toBe('fr');
  });

  it('识别德语', () => {
    expect(detectLanguage('Das ist eine sehr gute Idee, die wir gestern mit den Kindern hatten.')).toBe('de');
  });

  it('识别西班牙语', () => {
    expect(detectLanguage('Este es un texto que escribimos para probar el detector de idioma.')).toBe('es');
  });

  it('识别日语', () => {
    expect(detectLanguage('これは日本語の文章です。テストのために書いています。')).toBe('ja');
  });

  it('识别韩语', () => {
    expect(detectLanguage('이것은 언어 감지를 테스트하기 위해 쓴 한국어 문장입니다.')).toBe('ko');
  });

  it('识别俄语', () => {
    expect(detectLanguage('Это предложение написано на русском языке для проверки.')).toBe('ru');
  });

  it('太短判不出来', () => {
    expect(detectLanguage('Hi')).toBeNull();
  });

  it('纯 URL 不误判', () => {
    expect(detectLanguage('https://example.com/abc')).toBeNull();
  });

  it('空串返回 null', () => {
    expect(detectLanguage('')).toBeNull();
  });
});

describe('sameLangFamily', () => {
  it('简体与繁体同族', () => {
    expect(sameLangFamily('zh', 'zh-TW')).toBe(true);
    expect(sameLangFamily('zh-TW', 'zh')).toBe(true);
  });

  it('不同语言不同族', () => {
    expect(sameLangFamily('en', 'zh')).toBe(false);
    expect(sameLangFamily(null, 'zh')).toBe(false);
  });
});
