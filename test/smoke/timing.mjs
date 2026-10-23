/**
 * 计时诊断（临时脚本）：用指定段落跑一次真实链路，统计
 *   - 每次翻译发出的 /chat/completions 请求数
 *   - 点击 → 窗口出现（loading）耗时
 *   - 点击 → 结果渲染耗时
 * mock 端点可以配置延迟，用来模拟模型耗时。
 *
 * 用法：DELAY=0|1500 PORT=8792 node test/smoke/timing.mjs
 */

import { existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = resolve(root, 'dist');
const DELAY = Number(process.env.DELAY ?? 0);
const PORT = Number(process.env.PORT ?? 8792);
const BASE = `http://127.0.0.1:${PORT}`;


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

const TEXT = `I would save you the dissapointment, most of the wechat groups i am in, they are total silence, no one meets, mostly is for asking questions regarding life in Shenzhen and help. They are dead.People are busy, have husbands, children, work, and most if them already have their groups. Maybe you will have more sucess with groups were mostly Chinese are.Which i am not in because my Chinese is not good enough yet.

Find in xiahongshu English corners they are usually done every week, is for Chinese that want to practice English you will meet there Chinese and foreigners is a good start .i saw some posts about it. There are also activities like hiking or running groups, Chinese love sports so there are tons of that.`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>timing</title>
<style>body{font:18px/1.8 Georgia,serif;max-width:760px;margin:60px auto;padding:0 24px}</style>
</head><body><p id="p">${TEXT}</p></body></html>`;

let calls = 0;

function startServer() {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', BASE);
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      };
      if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
      if (url.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE);
      if (url.pathname === '/v1/models') {
        return res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'mock' }] }));
      }
      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        calls += 1;
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          let content = '{"blocks":[]}';
          try {
            const body = JSON.parse(raw);
            const blocks = JSON.parse(body.messages.find((m) => m.role === 'user')?.content ?? '[]');
            const out = blocks.map((b, i) => {
              const parts = String(b.text ?? '').split(/(\[\[\d+\]\])/);
              let tgt = '';
              for (const part of parts) {
                if (/^\[\[\d+\]\]$/.test(part)) tgt += part;
                else if (part.trim()) tgt += (tgt ? ' ' : '') + '这是译文。';
              }
              return { index: b.index ?? i, tgt: tgt.trim() };
            });
            content = JSON.stringify({ sourceLang: 'en', targetLang: 'zh', sameLanguage: false, blocks: out });
          } catch { /* ignore */ }
          setTimeout(() => {
            res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(
              JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
            );
          }, DELAY);
        });
        return;
      }
      res.writeHead(404, cors).end('nf');
    });
    server.listen(PORT, '127.0.0.1', () => done(server));
  });
}

function idFromPath(p) {
  const h = createHash('sha256').update(p).digest('hex').slice(0, 32);
  return Array.from(h).map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

async function main() {
  const server = await startServer();
  const executablePath = findChromium();
  if (!executablePath) throw new Error('找不到 Chromium，请安装或用 CHROME_PATH 指定');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--no-sandbox',
      '--disable-gpu',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  try {
    let extId = idFromPath(dist);
    try {
      const t = await browser.waitForTarget((x) => x.type() === 'service_worker', { timeout: 12000 });
      extId = new URL(t.url()).host;
    } catch { /* fallback */ }

    const setup = await browser.newPage();
    await setup.goto(`chrome-extension://${extId}/options.html`, { waitUntil: 'domcontentloaded' });
    await setup.evaluate(async (s) => {
      const cur = (await chrome.storage.local.get('settings')).settings ?? {};
      await chrome.storage.local.set({ settings: { ...cur, ...s } });
    }, {
      baseUrl: `${BASE}/v1`, apiKey: 'sk-timing', model: 'mock-timing',
      targetLang: 'zh', mode: 'bilingual', windowPreset: 'md', windowDims: null, windowPos: null,
    });
    await setup.close();

    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => Boolean(document.querySelector('#st-translator-root')?.shadowRoot));

    await page.evaluate(() => {
      const p = document.querySelector('#p');
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.waitForFunction(() => {
      const f = document.querySelector('#st-translator-root')?.shadowRoot?.querySelector('.st-fab');
      return Boolean(f && !f.hidden);
    }, { timeout: 5000 });

    calls = 0;
    const t0 = Date.now();
    await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      window.__stT0 = performance.now();
      sr.querySelector('.st-fab').click();
    });

    await page.waitForFunction(() => {
      const sr = document.querySelector('#st-translator-root')?.shadowRoot;
      return Boolean(sr && !sr.querySelector('.st-panel').hidden);
    }, { timeout: 15000 });
    const tOpen = Date.now();

    await page.waitForFunction(() => {
      const sr = document.querySelector('#st-translator-root')?.shadowRoot;
      return sr.querySelectorAll('.st-block').length >= 1;
    }, { timeout: 30000 });
    const tDone = Date.now();

    const inPage = await page.evaluate(() => {
      const sr = document.querySelector('#st-translator-root').shadowRoot;
      return {
        elapsed: performance.now() - window.__stT0,
        blocks: sr.querySelectorAll('.st-block').length,
        pairs: sr.querySelectorAll('.st-pair').length,
      };
    });

    console.log(JSON.stringify({
      delay: DELAY,
      requests: calls,
      openMs: tOpen - t0,
      resultMs: tDone - t0,
      inPageMs: Math.round(inPage.elapsed),
      blocks: inPage.blocks,
      pairs: inPage.pairs,
    }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
