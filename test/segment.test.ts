import { describe, expect, it } from 'vitest';
import { segmentBlocks, splitClauses, splitSentences } from '../src/content/segment';

describe('splitSentences', () => {
  it('英文按句末标点切', () => {
    expect(splitSentences('The fox jumps. It was quiet.')).toEqual(['The fox jumps.', 'It was quiet.']);
  });

  it('中文按句号切，逗号不切', () => {
    expect(splitSentences('第一句，带逗号。第二句！')).toEqual(['第一句，带逗号。', '第二句！']);
  });

  it('没有句末标点时整段当一句', () => {
    expect(splitSentences('no punctuation here')).toEqual(['no punctuation here']);
  });

  it('空串返回空数组', () => {
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('splitClauses', () => {
  it('短句不细拆', () => {
    const s = 'The fox jumps over the dog.';
    expect(splitClauses(s)).toEqual([s]);
  });

  it('长句按逗号与破折号切成小句', () => {
    const s =
      'To establish deterrence against Gulf states and pressure Washington through them, Tehran has issued threats over the past week indicating a capacity for ground invasions into neighboring countries - a scenario Israel warns could dramatically escalate regional turmoil.';
    const parts = splitClauses(s);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('To establish deterrence against Gulf states and pressure Washington through them,');
    expect(parts[1]).toBe(
      'Tehran has issued threats over the past week indicating a capacity for ground invasions into neighboring countries',
    );
    expect(parts[2]).toBe('a scenario Israel warns could dramatically escalate regional turmoil.');
  });

  it('长句按分号切', () => {
    const s =
      'The rain finally stopped after three long days; the sun came out and everyone in the village walked down to the river.';
    const parts = splitClauses(s);
    expect(parts).toHaveLength(2);
    expect(parts[0].endsWith('days;')).toBe(true);
  });

  it('引用里的逗号切分不吃掉后引号', () => {
    const s =
      '"The process is slow and constrained by knowledge gaps and production limits, but they are actively moving in that direction," a defense official noted.';
    expect(splitClauses(s)).toEqual([
      '"The process is slow and constrained by knowledge gaps and production limits,',
      'but they are actively moving in that direction," a defense official noted.',
    ]);
  });

  it('数字里的千位逗号不切', () => {
    const s =
      'The company produced 12,500 units in the first quarter of this year and exported 3,200 of them to overseas markets.';
    expect(splitClauses(s)).toEqual([s]);
  });

  it('中文长句不细拆，避免碎片化', () => {
    const s =
      '为了对海湾国家建立威慑，并通过这些国家向华盛顿施压，德黑兰在过去一周发出威胁，暗示其具备对邻国发动地面入侵的能力，以色列警告称这一情形可能使地区动荡急剧升级。';
    expect(splitClauses(s)).toEqual([s]);
  });
});

describe('segmentBlocks', () => {
  it('代码块不切', () => {
    const blocks = segmentBlocks([{ type: 'code', text: 'const a = 1. const b = 2.' }]);
    expect(blocks).toEqual([{ type: 'code', text: 'const a = 1. const b = 2.', units: ['const a = 1. const b = 2.'] }]);
  });

  it('标题不细拆', () => {
    const blocks = segmentBlocks([
      { type: 'heading', text: 'Iran resumes ballistic missile production, restores damaged weaponry' },
    ]);
    expect(blocks[0].units).toEqual(['Iran resumes ballistic missile production, restores damaged weaponry']);
  });

  it('段落先切句，长句再切分句，段落分组保留', () => {
    const blocks = segmentBlocks([
      {
        type: 'para',
        text:
          'Short one. Then the old man closed his book and looked toward the river, as if he had been waiting for exactly this moment.',
      },
    ]);
    expect(blocks).toEqual([
      {
        type: 'para',
        text: 'Short one. Then the old man closed his book and looked toward the river, as if he had been waiting for exactly this moment.',
        units: [
          'Short one.',
          'Then the old man closed his book and looked toward the river,',
          'as if he had been waiting for exactly this moment.',
        ],
      },
    ]);
  });

  it('空段落被丢掉', () => {
    expect(segmentBlocks([{ type: 'para', text: '   ' }])).toEqual([]);
  });
});
