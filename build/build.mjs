/**
 * 打包扩展：src → dist，产物就是一个能“加载已解压的扩展程序”的目录。
 *
 * 三个必须这样的选项：
 * | 选项 | 为什么 |
 * |---|---|
 * | format: 'iife' | 内容脚本不支持 ES 模块 import，必须打成自足脚本；SW 也照此处理 |
 * | bundle: true  | 扩展里不带 node_modules，页面侧零运行时依赖 |
 * | charset: 'utf8' | 中文提示不转成 \uXXXX，源码可读 |
 */

import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

async function copyStatic() {
  await mkdir(dist, { recursive: true });
  await copyFile(resolve(root, 'src/manifest.json'), resolve(dist, 'manifest.json'));
  await copyFile(resolve(root, 'src/options/options.html'), resolve(dist, 'options.html'));
}

async function main() {
  await rm(dist, { recursive: true, force: true });
  await copyStatic();

  const options = {
    entryPoints: {
      content: resolve(root, 'src/entries/content.ts'),
      background: resolve(root, 'src/entries/background.ts'),
      options: resolve(root, 'src/options/options.ts'),
    },
    outdir: dist,
    bundle: true,
    format: 'iife',
    target: 'chrome109',
    platform: 'browser',
    sourcemap: true,
    logLevel: 'info',
    charset: 'utf8',
  };

  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log(`[watch] 构建完成，产物在 ${dist}`);
    return;
  }

  await build(options);
  console.log(`[build] 构建完成，产物在 ${dist}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
