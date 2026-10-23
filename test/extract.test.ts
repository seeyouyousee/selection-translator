// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { blocksFromFragment, blocksFromPlainText } from '../src/content/extract';

function fragmentOf(html: string): DocumentFragment {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const frag = document.createDocumentFragment();
  while (holder.firstChild) frag.appendChild(holder.firstChild);
  return frag;
}

describe('blocksFromFragment（按段落切块，不按句子切）', () => {
  it('两个段落就是两块，段内不拆句', () => {
    const blocks = blocksFromFragment(
      fragmentOf('<p>The first sentence. The second sentence.</p><p>Another paragraph here.</p>'),
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('para');
    expect(blocks[0].text).toBe('The first sentence. The second sentence.');
    expect(blocks[1].text).toBe('Another paragraph here.');
  });

  it('标题 / 列表 / 引用 / 代码各有类型', () => {
    const blocks = blocksFromFragment(
      fragmentOf(
        '<h2>Chapter One</h2><p>Body text.</p><ul><li>First item</li><li>Second item</li></ul>' +
          '<blockquote>Quoted line</blockquote><pre>const a = 1;\nconst b = 2;</pre>',
      ),
    );
    const types = blocks.map((b) => b.type);
    expect(types).toEqual(['heading', 'para', 'list', 'list', 'quote', 'code']);
    expect(blocks[5].text).toBe('const a = 1;\nconst b = 2;');
  });

  it('嵌套容器里的段落会被拆开', () => {
    const blocks = blocksFromFragment(fragmentOf('<div><p>One.</p><p>Two.</p></div>'));
    expect(blocks.map((b) => b.text)).toEqual(['One.', 'Two.']);
  });

  it('行内标签并进同一块', () => {
    const blocks = blocksFromFragment(fragmentOf('<p>Hello <strong>world</strong>, this is <em>one</em> paragraph.</p>'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('Hello world, this is one paragraph.');
  });

  it('<br> 保留为换行，源码换行折成空格', () => {
    const blocks = blocksFromFragment(fragmentOf('<p>line one<br>line two</p>'));
    expect(blocks[0].text).toBe('line one\nline two');
  });

  it('表格按单元格拆块', () => {
    const blocks = blocksFromFragment(fragmentOf('<table><tr><td>Cell A</td><td>Cell B</td></tr></table>'));
    expect(blocks.map((b) => b.text)).toEqual(['Cell A', 'Cell B']);
  });

  it('跳过脚本与样式', () => {
    const blocks = blocksFromFragment(
      fragmentOf('<p>Keep me.</p><script>var x = 1;</script><style>.a{color:red}</style>'),
    );
    expect(blocks.map((b) => b.text)).toEqual(['Keep me.']);
  });

  it('纯文本节点也能成块', () => {
    const blocks = blocksFromFragment(fragmentOf('Just a loose sentence.'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('Just a loose sentence.');
  });
});

describe('blocksFromPlainText', () => {
  it('按空行切段', () => {
    const blocks = blocksFromPlainText('Para one.\n\nPara two.');
    expect(blocks.map((b) => b.text)).toEqual(['Para one.', 'Para two.']);
  });

  it('空内容返回空数组', () => {
    expect(blocksFromPlainText('   \n  ')).toEqual([]);
  });
});
