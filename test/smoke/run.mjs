/**
 * 真机冒烟：真实 Chrome 加载 dist/ 扩展 + 本地 mock LLM 端点，跑完整交互链路。
 *
 * 覆盖：
 *  1. 选英文段 → 浮钮 → 点开窗口 → 双语对照（逐句交错：原文句 → 该句译文）
 *  2. 切单语 → 只留译文（不重新请求）
 *  3. 关闭窗口
 *  4. 选中文段（目标语言）→ 不调 API，强制单语显示原文
 *
 * 用法：node test/smoke/run.mjs
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = resolve(root, 'dist');

/**
 * 找一个能加载未打包扩展的浏览器。
 * Chrome 品牌版从 137 起禁用 --load-extension，所以优先 Chromium。
 * 可用 CHROME_PATH 指定；也会去 Playwright 的缓存目录里找。
 */
function findChromium() {
  const direct = [
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium-freeworld',
    '/snap/bin/chromium',
  ].filter((p) => typeof p === 'string' && p.length > 0);
  for (const p of direct) if (existsSync(p)) return p;
  try {
    const base = join(homedir(), '.cache', 'ms-playwright');
    for (const dir of readdirSync(base)) {
      const p = join(base, dir, 'chrome-linux64', 'chrome');
      if (existsSync(p)) return p;
    }
  } catch {
    /* ignore */
  }
  return null;
}

const outDir = resolve(root, 'test/smoke/out');
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;

const LONG_EN = (
  'The river ran slowly through the valley, carrying leaves and small branches toward the sea. ' +
  'Every few minutes a heron lifted itself from the shallows and crossed to the other bank. ' +
  'Nobody in the village could remember a morning quite like this one, and so they stood by the water in silence. '
).repeat(4);

const LONG_ZH = '这是一段用于验证“内容展示不全时出现内部滚动条”的较长译文。'.repeat(70);

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Smoke Article</title>
<style>
  body { margin:0; background:#f3f1ec; color:#22201c; font-family: Georgia, "Times New Roman", serif; }
  main { max-width: 720px; margin: 0 auto; padding: 56px 24px 120px; }
  h1 { font-size: 30px; line-height:1.3; margin: 0 0 8px; }
  .meta { color:#8a8377; font-size:13px; margin-bottom: 34px; font-family: system-ui, sans-serif; }
  p { font-size: 18px; line-height: 1.85; margin: 0 0 22px; }
  .zh { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color:#333; }
</style></head>
<body><main>
  <h1>The Quiet Morning</h1>
  <div class="meta">Smoke test fixture · 2024</div>
  <p id="en-1">The quick brown fox jumps over the lazy dog. It was a quiet morning, and the whole valley seemed to be holding its breath.</p>
  <p id="en-2">Nobody spoke for a while. Then the old man closed his book and looked toward the river, as if he had been waiting for exactly this moment.</p>
  <p id="zh-1" class="zh">这是一个用来验证语言短路的段落。它本身已经是目标语言，因此不应该触发任何翻译请求。</p>
  <p id="long">${LONG_EN}</p>
  <p><input id="search" type="text" value="我想找一家南山蛇口的意大利餐厅" style="width:100%;padding:10px;font-size:16px;border:1px solid #ccc;border-radius:6px" /></p>
  <p><textarea id="reply" rows="2" style="width:100%;font-size:16px;padding:10px">This is my reply.</textarea></p>
  <div id="ce" contenteditable="true" style="border:1px solid #ccc;border-radius:6px;padding:10px;min-height:44px;font-size:16px">我想在这里练习英语，并认识一些朋友。</div>
</main></body></html>`;

// 与 fixture 切出来的翻译单元逐一对应：
// en-1 → 2 个（第 2 句逗号前只有 22 字符，碎片被并回整句）
// en-2 → 3 个（第 4 句在逗号处细拆成两个分句）
const ZH = [
  '敏捷的棕色狐狸跃过了那只懒狗。',
  '那是一个安静的早晨，整个山谷仿佛都屏住了呼吸。',
  '好一会儿没有人说话。',
  '然后老人合上书，望向河面，',
  '像是在等待的正是这一刻。',
];

/**
 * mock 模型：按标记分段、逐段给译文，并保留标记。
 * mode: normal 保留全部；merge 丢掉第一个标记（=合并）；broken 把编号 0 改成 1（=不自洽）
 */
function mockTranslation(text, srcLen, nextZh, mode) {
  const parts = String(text ?? '').split(/(\[\[\d+\]\])/);
  let result = '';
  let seenMarker = false;
  for (const part of parts) {
    const m = part.match(/^\[\[(\d+)\]\]$/);
    if (m) {
      const id = Number(m[1]);
      if (mode === 'merge' && !seenMarker) {
        seenMarker = true;
        continue;
      }
      seenMarker = true;
      const emit = mode === 'broken' && id === 0 ? 1 : id;
      result += `[[${emit}]]`;
      continue;
    }
    const t = part.trim();
    if (!t) continue;
    result += (result ? ' ' : '') + (srcLen > 300 ? LONG_ZH : nextZh());
  }
  return result.trim();
}

let apiCalls = 0;
let lastRequestBody = null;

function startServer() {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', BASE);
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      };

      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors).end();
        return;
      }

      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE);
        return;
      }

      if (url.pathname === '/v1/models') {
        res
          .writeHead(200, { ...cors, 'Content-Type': 'application/json' })
          .end(JSON.stringify({ object: 'list', data: [{ id: 'mock-translator' }] }));
        return;
      }

      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        apiCalls += 1;
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          try {
            lastRequestBody = JSON.parse(raw);
            const systemMsg = String(
              lastRequestBody.messages.find((m) => m.role === 'system')?.content ?? '',
            );
            if (/input box/i.test(systemMsg)) {
              const inputText = String(
                lastRequestBody.messages.find((m) => m.role === 'user')?.content ?? '',
              );
              const content = JSON.stringify({ tgt: `输入译文：${inputText}` });
              res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(
                JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
              );
              return;
            }
            const userMsg = lastRequestBody.messages.find((m) => m.role === 'user')?.content ?? '[]';
            const blocks = JSON.parse(userMsg);
            const srcLen = blocks.reduce((n, b) => n + String(b.text ?? '').length, 0);
            const mode =
              lastRequestBody.model === 'mock-merge'
                ? 'merge'
                : lastRequestBody.model === 'mock-broken'
                  ? 'broken'
                  : 'normal';
            let zhIndex = 0;
            const nextZh = () => ZH[zhIndex++] ?? `第 ${zhIndex} 个单元译文。`;
            const content = JSON.stringify({
              sourceLang: 'en',
              targetLang: 'zh',
              sameLanguage: false,
              blocks: blocks.map((b, bi) => ({
                index: b.index ?? bi,
                tgt: mockTranslation(b.text, srcLen, nextZh, mode),
              })),
            });
            res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(
              JSON.stringify({
                id: 'mock-1',
                object: 'chat.completion',
                choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
              }),
            );
          } catch (e) {
            res.writeHead(400, { ...cors, 'Content-Type': 'application/json' }).end(
              JSON.stringify({ error: { message: `bad request: ${e.message}` } }),
            );
          }
        });
        return;
      }

      res.writeHead(404, cors).end('not found');
    });
    server.listen(PORT, '127.0.0.1', () => resolvePromise(server));
  });
}

function extensionIdFromPath(path) {
  const hash = createHash('sha256').update(path).digest('hex').slice(0, 32);
  return Array.from(hash)
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join('');
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = await startServer();
  const logs = [];

  // Chrome 品牌版从 137 起硬禁 --load-extension（二进制里直接 "ignoring"），
  // 所以冒烟用 Chromium。可用 CHROME_PATH 覆盖。
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error(
      '找不到可用的 Chromium。Chrome 品牌版禁用了 --load-extension；请安装 Chromium，或用 CHROME_PATH 指定可执行文件。',
    );
  }
  console.log(`[smoke] 浏览器：${executablePath}`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-sandbox',
      '--disable-gpu',
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  try {
    let extensionId = null;
    try {
      const target = await browser.waitForTarget(
        (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
        { timeout: 15000 },
      );
      extensionId = new URL(target.url()).host;
    } catch {
      extensionId = extensionIdFromPath(dist);
      console.log(`[smoke] 未捕获 SW target，按路径推算扩展 ID：${extensionId}`);
    }
    console.log(`[smoke] 扩展 ID：${extensionId}`);

    // 通过设置页写配置（不依赖 SW 是否已唤醒）；patch 会与已有配置合并
    const setSettings = async (patch) => {
      const p = await browser.newPage();
      await p.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
      await p.evaluate(
        async (patch) => {
          const cur = (await chrome.storage.local.get('settings')).settings ?? {};
          await chrome.storage.local.set({ settings: { ...cur, ...patch } });
        },
        patch,
      );
      await p.close();
    };

    // 1) 写入初始配置
    await setSettings({
      baseUrl: `${BASE}/v1`,
      apiKey: 'sk-mock-key',
      model: 'mock-translator',
      targetLang: 'zh',
      mode: 'bilingual',
      windowPreset: 'md',
      windowDims: null,
      windowPos: null,
    });

    // 2) 打开测试页
    const page = await browser.newPage();
    page.on('console', (m) => logs.push(`[page:${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => Boolean(document.querySelector('#st-translator-root')?.shadowRoot), {
      timeout: 8000,
    });

    const selectParagraphs = async (firstId, lastId) => {
      await page.evaluate(
        (a, b) => {
          const start = document.querySelector(a);
          const end = document.querySelector(b);
          if (!start || !end) throw new Error(`missing ${a} / ${b}`);
          const range = document.createRange();
          range.setStartBefore(start);
          range.setEndAfter(end);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
        },
        `#${firstId}`,
        `#${lastId}`,
      );
    };

    const waitFab = () =>
      page.waitForFunction(
        () => {
          const fab = document.querySelector('#st-translator-root')?.shadowRoot?.querySelector('.st-fab');
          return Boolean(fab && !fab.hidden);
        },
        { timeout: 6000 },
      );

    const clickFab = () =>
      page.evaluate(() => {
        document.querySelector('#st-translator-root').shadowRoot.querySelector('.st-fab').click();
      });

    const waitResult = () =>
      page.waitForFunction(
        () => {
          const sr = document.querySelector('#st-translator-root')?.shadowRoot;
          const panel = sr?.querySelector('.st-panel');
          if (!panel || panel.hidden) return false;
          return sr.querySelectorAll('.st-block').length >= 1 || Boolean(sr.querySelector('.st-state-title'));
        },
        { timeout: 12000 },
      );

    const readWindow = () =>
      page.evaluate(() => {
        const sr = document.querySelector('#st-translator-root').shadowRoot;
        const text = (sel) => [...sr.querySelectorAll(sel)].map((n) => n.textContent);
        const pressed = [...sr.querySelectorAll('.st-seg-btn')].find((b) => b.getAttribute('aria-pressed') === 'true');
        return {
          hidden: sr.querySelector('.st-panel').hidden,
          title: sr.querySelector('.st-title').textContent,
          bodyClass: sr.querySelector('.st-body').className,
          srcs: text('.st-src'),
          tgts: text('.st-tgt'),
          mode: pressed?.textContent ?? null,
          blocks: sr.querySelectorAll('.st-block').length,
        };
      });

    /* ---- 场景 1：英文段落 → 双语对照 ---- */
    const before = apiCalls;
    await selectParagraphs('en-1', 'en-2');
    await waitFab();
    await clickFab();
    await waitResult();
    await page.waitForFunction(
      () => {
        const sr = document.querySelector('#st-translator-root').shadowRoot;
        return sr.querySelectorAll('.st-block').length === 2;
      },
      { timeout: 12000 },
    );

    let view = await readWindow();
    assert.equal(view.hidden, false, '窗口应自动弹出');
    assert.equal(view.blocks, 2, '两个 <p> 应得到 2 个段落分组');
    assert.equal(view.srcs.length, 5, '按句+长句分句，应得到 5 个翻译单元');
    assert.equal(view.tgts.length, 5, '应逐单元给出 5 条译文');
    assert.equal(view.srcs[0], 'The quick brown fox jumps over the lazy dog.');
    assert.equal(view.srcs[1], 'It was a quiet morning, and the whole valley seemed to be holding its breath.', '逗号前碎片太短，应并回整句');
    assert.equal(view.srcs[2], 'Nobody spoke for a while.');
    assert.equal(view.srcs[3], 'Then the old man closed his book and looked toward the river,', '长句应在逗号处细拆');
    assert.equal(view.srcs[4], 'as if he had been waiting for exactly this moment.');
    assert.equal(view.tgts[0], ZH[0], '第 1 个单元译文应对齐');
    assert.equal(view.tgts[1], ZH[1], '第 2 个单元译文应对齐');
    assert.equal(view.tgts[2], ZH[2], '第 3 个单元译文应对齐');
    assert.equal(view.tgts[3], ZH[3], '第 4 个单元译文应对齐');
    assert.equal(view.tgts[4], ZH[4], '第 5 个单元译文应对齐');
    assert.match(view.title, /英语\s*→\s*中文/);
    assert.equal(view.mode, '双语');
    assert.equal(apiCalls, before + 1, '一次翻译只应发一次请求');

    const layout = await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      const panel = sr.querySelector('.st-panel');
      const pr = panel.getBoundingClientRect();
      const rows = [...sr.querySelectorAll('.st-pair')].map((row) => {
        const s = row.querySelector('.st-src').getBoundingClientRect();
        const t = row.querySelector('.st-tgt');
        const tr = t.getBoundingClientRect();
        const cs = getComputedStyle(t);
        return {
          srcTop: s.top,
          srcBottom: s.bottom,
          tgtTop: tr.top,
          tgtBottom: tr.bottom,
          borderLeft: cs.borderLeftWidth,
        };
      });
      return {
        rows,
        panel: { w: pr.width, h: pr.height, left: pr.left, top: pr.top, vw: innerWidth, vh: innerHeight },
      };
    });

    assert.equal(layout.rows.length, 5, '双语模式应有 5 个「原文 + 译文」单元');
    for (const row of layout.rows) {
      assert.ok(row.tgtTop > row.srcTop, '每句译文必须紧跟在该句原文下方');
      assert.equal(row.borderLeft, '3px', '译文应有左侧标线，与原文区分');
    }
    // 逐句交错：下一句的原文必须排在上句译文之后
    for (let i = 1; i < layout.rows.length; i += 1) {
      assert.ok(
        layout.rows[i].srcTop > layout.rows[i - 1].tgtBottom,
        `第 ${i + 1} 句原文应排在上一句译文之后（逐句交错，不是整段并列）`,
      );
    }
    assert.ok(Math.abs(layout.panel.w - 520) <= 1, `窗口宽度应取中档预设 520，实际 ${layout.panel.w}`);
    assert.ok(Math.abs(layout.panel.h - 560) <= 1, `窗口高度应取中档预设 560，实际 ${layout.panel.h}`);
    assert.ok(layout.panel.left >= 0 && layout.panel.top >= 0, '窗口不应超出视口左上');
    assert.ok(
      layout.panel.left + layout.panel.w <= layout.panel.vw + 1 && layout.panel.top + layout.panel.h <= layout.panel.vh + 1,
      '窗口不应超出视口右下',
    );

    console.log('[smoke] ✓ 双语对照：2 段 5 个单元（长句已细拆成分句），逐单元交错，译文带左标线');
    await page.screenshot({ path: resolve(outDir, 'bilingual.png') });

    /* ---- 底栏入口：大号关闭 + 设置入口 ---- */
    const chromeBits = await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      const r = sr.querySelector('.st-close').getBoundingClientRect();
      const foot = sr.querySelector('.st-foot');
      const footClose = foot?.querySelector('.st-foot-primary')?.getBoundingClientRect();
      return {
        hasFoot: Boolean(foot),
        buttons: foot ? [...foot.querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
        closeW: r.width,
        closeH: r.height,
        footCloseW: footClose ? footClose.width : 0,
      };
    });
    assert.ok(chromeBits.hasFoot, '窗口底部应有常驻操作栏');
    assert.deepEqual(chromeBits.buttons, ['⚙ 设置', '关闭'], '底栏应有「设置」和「关闭」两个按钮');
    assert.ok(chromeBits.closeW >= 30 && chromeBits.closeH >= 30, `× 按钮应足够大，实际 ${chromeBits.closeW}x${chromeBits.closeH}`);
    assert.ok(chromeBits.footCloseW >= 120, `底栏「关闭」应拉长（≥120px），实际 ${chromeBits.footCloseW}`);

    // 关掉安装时自动打开的设置页，确保下面点到的是“新开的”
    for (const t of browser.targets()) {
      if (t.url().includes('/options.html')) {
        const p = await t.page();
        if (p) await p.close();
      }
    }
    await page.evaluate(() => {
      document.querySelector('#st-translator-root').shadowRoot.querySelector('.st-foot-ghost').click();
    });
    const settingsTarget = await browser.waitForTarget((t) => t.url().includes('/options.html'), {
      timeout: 5000,
    });
    const settingsPage = await settingsTarget.page();
    assert.ok(settingsPage, '点「设置」应打开设置页');
    await settingsPage.close();
    console.log('[smoke] ✓ 底栏：× 已放大到 32px；「设置」能新开设置页');

    /* ---- 场景 2：切单语，只重排不重翻 ---- */
    const callsBeforeMono = apiCalls;
    await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      [...sr.querySelectorAll('.st-seg-btn')].find((b) => b.textContent === '单语').click();
    });
    await page.waitForFunction(
      () => {
        const sr = document.querySelector('#st-translator-root').shadowRoot;
        return sr.querySelector('.st-body').classList.contains('st-mono') && sr.querySelectorAll('.st-src').length === 0;
      },
      { timeout: 4000 },
    );
    view = await readWindow();
    assert.equal(view.srcs.length, 0, '单语模式不应显示原文');
    assert.equal(view.tgts.length, 2, '单语模式按段落分组，应为 2 条译文');
    assert.equal(view.tgts[0], `${ZH[0]}${ZH[1]}`, '段内单元译文应拼回完整段落（中文不加空格）');
    assert.equal(view.tgts[1], `${ZH[2]}${ZH[3]}${ZH[4]}`);
    assert.equal(apiCalls, callsBeforeMono, '切模式不应重新请求');
    console.log('[smoke] ✓ 单语模式：只剩译文，且未重新请求');
    await page.screenshot({ path: resolve(outDir, 'mono.png') });

    /* ---- 场景 3：底栏「关闭」按钮关窗 ---- */
    await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      sr.querySelector('.st-foot-primary').click();
    });
    await page.waitForFunction(
      () => document.querySelector('#st-translator-root').shadowRoot.querySelector('.st-panel').hidden,
      { timeout: 3000 },
    );
    console.log('[smoke] ✓ 点底栏「关闭」后窗口退出');

    /* ---- 场景 4：中文段（已是目标语言）→ 不调 API、强制单语 ---- */
    const callsBeforeZh = apiCalls;
    await selectParagraphs('zh-1', 'zh-1');
    await waitFab();
    await clickFab();
    await waitResult();
    view = await readWindow();
    assert.equal(view.hidden, false, '窗口应弹出');
    assert.equal(apiCalls, callsBeforeZh, '已是目标语言时不应调用 API');
    assert.match(view.title, /已是目标语言/, '标题应说明无需翻译');
    assert.equal(view.bodyClass.includes('st-mono'), true, '应强制单语');
    assert.equal(view.srcs.length, 0, '不应出现双语对照');
    assert.equal(view.tgts.length, 1, '应直接显示原文块');
    assert.match(view.tgts[0], /这是一个用来验证语言短路的段落/);
    console.log('[smoke] ✓ 语言短路：中文段落不调 API，强制单语显示原文');
    await page.screenshot({ path: resolve(outDir, 'same-language.png') });

    await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      sr.querySelector('.st-close').click();
    });

    /* ---- 场景 5：长内容 → 窗口内部滚动，不撑破视口 ---- */
    await selectParagraphs('long', 'long');
    await waitFab();
    await clickFab();
    await waitResult();
    await page.waitForFunction(
      () => document.querySelector('#st-translator-root').shadowRoot.querySelectorAll('.st-block').length === 1,
      { timeout: 12000 },
    );
    const scroll = await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      const panel = sr.querySelector('.st-panel').getBoundingClientRect();
      const body = sr.querySelector('.st-body');
      return {
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
        overflowY: getComputedStyle(body).overflowY,
        panelH: panel.height,
        vh: innerHeight,
      };
    });
    assert.ok(scroll.scrollHeight > scroll.clientHeight, `长内容应出现内部滚动（scrollH ${scroll.scrollHeight} > clientH ${scroll.clientHeight}）`);
    assert.equal(scroll.overflowY, 'auto', '滚动容器应为 overflow-y:auto');
    assert.ok(scroll.panelH < scroll.vh, '窗口高度不应被内容撑破视口');
    console.log('[smoke] ✓ 长内容：窗口高度不变，内容区出现内部滚动条');
    await page.screenshot({ path: resolve(outDir, 'long-scroll.png') });

    await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      sr.querySelector('.st-close').click();
    });

    /* ---- 场景 6：手动调尺寸 → 记住；重开沿用尺寸与上次模式 ---- */
    await selectParagraphs('en-1', 'en-2');
    await waitFab();
    await clickFab();
    await waitResult();
    await page.waitForFunction(
      () => document.querySelector('#st-translator-root').shadowRoot.querySelectorAll('.st-block').length === 2,
      { timeout: 12000 },
    );
    await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      const panel = sr.querySelector('.st-panel');
      panel.style.width = '460px';
      panel.style.height = '480px';
    });
    await new Promise((r) => setTimeout(r, 1000));
    await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      sr.querySelector('.st-close').click();
    });

    await selectParagraphs('en-1', 'en-2');
    await waitFab();
    await clickFab();
    await waitResult();
    await page.waitForFunction(
      () => document.querySelector('#st-translator-root').shadowRoot.querySelectorAll('.st-block').length === 2,
      { timeout: 12000 },
    );
    const restored = await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      const r = sr.querySelector('.st-panel').getBoundingClientRect();
      const pressed = [...sr.querySelectorAll('.st-seg-btn')].find((b) => b.getAttribute('aria-pressed') === 'true');
      return { w: r.width, h: r.height, mode: pressed?.textContent ?? null };
    });
    assert.ok(Math.abs(restored.w - 460) <= 1, `重开应沿用记住的宽度 460，实际 ${restored.w}`);
    assert.ok(Math.abs(restored.h - 480) <= 1, `重开应沿用记住的高度 480，实际 ${restored.h}`);
    assert.equal(restored.mode, '单语', '重开应沿用上次选择的展示模式');
    console.log('[smoke] ✓ 手动尺寸被记住、重开沿用，展示模式也沿用上次');
    await page.screenshot({ path: resolve(outDir, 'restored-size.png') });

    await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      sr.querySelector('.st-close').click();
    });

    /* ---- 场景 7：模型丢掉标记 = 合并相邻两块（仍一次请求） ---- */
    await setSettings({ model: 'mock-merge', mode: 'bilingual' });
    const callsBeforeMerge = apiCalls;
    await selectParagraphs('en-1', 'en-2');
    await waitFab();
    await clickFab();
    await waitResult();
    await page.waitForFunction(
      () => document.querySelector('#st-translator-root').shadowRoot.querySelectorAll('.st-block').length === 2,
      { timeout: 12000 },
    );
    const mergedView = await readWindow();
    assert.equal(apiCalls - callsBeforeMerge, 1, '合并不该增加请求次数');
    assert.equal(mergedView.tgts.length, 3, '两块各丢一个标记 → 共 3 条译文');
    assert.equal(
      mergedView.srcs[0],
      'The quick brown fox jumps over the lazy dog. It was a quiet morning, and the whole valley seemed to be holding its breath.',
      '被合并的两个单元应拼成一条原文',
    );
    console.log('[smoke] ✓ 丢标记=合并：相邻两块合成一条，仍是一次请求');
    await page.screenshot({ path: resolve(outDir, 'merged.png') });

    await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      sr.querySelector('.st-close').click();
    });
    await setSettings({ model: 'mock-translator' });

    /* ---- 场景 8：标记不自洽 → 整段作为一个整体（不重试） ---- */
    await setSettings({ model: 'mock-broken', mode: 'bilingual' });
    const callsBeforeBroken = apiCalls;
    await selectParagraphs('en-1', 'en-2');
    await waitFab();
    await clickFab();
    await waitResult();
    await page.waitForFunction(
      () => document.querySelector('#st-translator-root').shadowRoot.querySelectorAll('.st-block').length === 2,
      { timeout: 12000 },
    );
    const brokenView = await readWindow();
    assert.equal(apiCalls - callsBeforeBroken, 1, '标记不自洽也不重试，仍是一次请求');
    assert.equal(brokenView.tgts.length, 2, '每块降级为整段一条');
    assert.equal(brokenView.srcs.length, 2);
    assert.equal(
      brokenView.srcs[0],
      'The quick brown fox jumps over the lazy dog. It was a quiet morning, and the whole valley seemed to be holding its breath.',
      '整段原文作为一个 src',
    );
    console.log('[smoke] ✓ 标记不自洽：整段作为一个整体，不重试');
    await page.screenshot({ path: resolve(outDir, 'whole-paragraph.png') });

    await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      sr.querySelector('.st-close').click();
    });
    await setSettings({ model: 'mock-translator' });

    /* ---- 场景 9：输入框里选中 → 译 → 原位替换 ---- */
    await setSettings({ model: 'mock-translator', mode: 'bilingual' });
    const callsBeforeInput = apiCalls;

    await page.evaluate(() => {
      const el = document.querySelector('#search');
      el.focus();
      el.setSelectionRange(0, el.value.length);
      el.dispatchEvent(new Event('select'));
      document.dispatchEvent(new Event('selectionchange'));
    });
    await waitFab();
    await clickFab();
    await page.waitForFunction(
      () => String(document.querySelector('#search')?.value ?? '').startsWith('输入译文：'),
      { timeout: 12000 },
    );
    assert.equal(apiCalls - callsBeforeInput, 1, '输入框翻译只发 1 次请求');
    const inputSystem = String(
      lastRequestBody.messages.find((m) => m.role === 'system')?.content ?? '',
    );
    assert.ok(/Translate into English/.test(inputSystem), '输入翻译应使用「输入目标语言」English');
    console.log('[smoke] ✓ 输入框：选中 → 译 → 原位替换（用输入目标语言）');

    await page.evaluate(() => {
      const el = document.querySelector('#ce');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await waitFab();
    await clickFab();
    await page.waitForFunction(
      () => String(document.querySelector('#ce')?.innerText ?? '').includes('输入译文：'),
      { timeout: 12000 },
    );
    assert.equal(apiCalls - callsBeforeInput, 2, '两次输入翻译共 2 次请求');
    console.log('[smoke] ✓ contenteditable：选中 → 译 → 原位替换');
    await page.screenshot({ path: resolve(outDir, 'input-replace.png') });

    await writeFile(
      resolve(outDir, 'run.log'),
      `extensionId=${extensionId}\napiCalls=${apiCalls}\nlastRequest=${JSON.stringify(lastRequestBody, null, 2)}\n${logs.join('\n')}\n`,
    );

    console.log(`[smoke] 全部通过；截图在 ${outDir}`);
  } catch (e) {
    console.error('--- page logs ---');
    console.error(logs.join('\n'));
    throw e;
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error('[smoke] 失败：', e);
  process.exit(1);
});
