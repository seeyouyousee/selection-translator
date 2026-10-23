import { describe, expect, it } from 'vitest';
import { parseMarkedResult, TranslateParseError } from '../src/shared/parse';
import type { SegmentBlock, TranslateResult } from '../src/shared/types';

const BLOCKS: SegmentBlock[] = [
  {
    type: 'para',
    text: 'Hello there. Goodbye now. One more thing.',
    units: ['Hello there.', 'Goodbye now.', 'One more thing.'],
  },
];

const tgtsOf = (r: TranslateResult): string[] => r.blocks.flatMap((b) => b.pairs.map((p) => p.tgt));
const srcsOf = (r: TranslateResult): string[] => r.blocks.flatMap((b) => b.pairs.map((p) => p.src));

const wrap = (tgt: string): string =>
  JSON.stringify({
    sourceLang: 'en',
    targetLang: 'zh',
    sameLanguage: false,
    blocks: [{ index: 0, tgt }],
  });

describe('parseMarkedResult（原文只发一次，标记表达切分）', () => {
  it('标记齐全：逐单元对照', () => {
    const result = parseMarkedResult(wrap('你好。[[0]]再见。[[1]]还有一句。'), BLOCKS, 'zh');
    expect(result.blocks[0].pairs).toEqual([
      { src: 'Hello there.', tgt: '你好。' },
      { src: 'Goodbye now.', tgt: '再见。' },
      { src: 'One more thing.', tgt: '还有一句。' },
    ]);
  });

  it('丢掉一个标记 = 相邻两块合并', () => {
    const result = parseMarkedResult(wrap('你好。[[0]]再见。还有一句。'), BLOCKS, 'zh');
    expect(result.blocks[0].pairs).toEqual([
      { src: 'Hello there.', tgt: '你好。' },
      { src: 'Goodbye now. One more thing.', tgt: '再见。还有一句。' },
    ]);
  });

  it('标记全丢 = 整段合并成一条', () => {
    const result = parseMarkedResult(wrap('你好。再见。还有一句。'), BLOCKS, 'zh');
    expect(result.blocks[0].pairs).toHaveLength(1);
    expect(result.blocks[0].pairs[0].src).toBe('Hello there. Goodbye now. One more thing.');
  });

  it('标记乱序 → 不自洽 → 整段作为一个整体', () => {
    const result = parseMarkedResult(wrap('你好。[[1]]再见。[[0]]还有一句。'), BLOCKS, 'zh');
    expect(result.blocks[0].pairs).toHaveLength(1);
    expect(result.blocks[0].pairs[0].src).toBe('Hello there. Goodbye now. One more thing.');
    expect(result.blocks[0].pairs[0].tgt).toBe('你好。再见。还有一句。');
  });

  it('标记越界/新增 → 不自洽 → 整段作为一个整体', () => {
    const result = parseMarkedResult(wrap('你好。[[9]]再见。'), BLOCKS, 'zh');
    expect(result.blocks[0].pairs).toHaveLength(1);
    expect(result.blocks[0].pairs[0].src).toBe('Hello there. Goodbye now. One more thing.');
  });

  it('标记重复 → 不自洽 → 整段作为一个整体', () => {
    const result = parseMarkedResult(wrap('你好。[[0]]再见。[[0]]还有一句。'), BLOCKS, 'zh');
    expect(result.blocks[0].pairs).toHaveLength(1);
  });

  it('标记前出现空片段 → 不自洽 → 整段作为一个整体', () => {
    const result = parseMarkedResult(wrap('[[0]]你好。[[1]]再见。还有一句。'), BLOCKS, 'zh');
    expect(result.blocks[0].pairs).toHaveLength(1);
    expect(result.blocks[0].pairs[0].src).toBe('Hello there. Goodbye now. One more thing.');
  });

  it('空译文要报错', () => {
    expect(() => parseMarkedResult(wrap('   '), BLOCKS, 'zh')).toThrow(TranslateParseError);
  });

  it('段数不符要报错', () => {
    const content = JSON.stringify({ blocks: [] });
    expect(() => parseMarkedResult(content, BLOCKS, 'zh')).toThrow(TranslateParseError);
  });

  it('不是 JSON 要报错', () => {
    expect(() => parseMarkedResult('随便一段没有结构的话', BLOCKS, 'zh')).toThrow(
      TranslateParseError,
    );
  });

  it('single 单元时不应把标记留给用户', () => {
    const one: SegmentBlock[] = [{ type: 'para', text: 'Just one.', units: ['Just one.'] }];
    const result = parseMarkedResult(wrap('就这一句。'), one, 'zh');
    expect(tgtsOf(result)).toEqual(['就这一句。']);
    expect(srcsOf(result)).toEqual(['Just one.']);
  });
});
