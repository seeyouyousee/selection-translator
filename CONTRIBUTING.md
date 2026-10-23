# Contributing

感谢愿意一起改进这个扩展。改动前请先读一遍 [REQUIREMENTS.md](./REQUIREMENTS.md)，里面写死了几条不能破坏的约束（一次请求、标记自洽、输入翻译直接替换等）。

## 环境

- Node.js ≥ 20
- pnpm
- 跑真机冒烟还需要 **Chromium**（Chrome 品牌版从 137 起禁用 `--load-extension`）

## 常用命令

```bash
pnpm install
pnpm check      # tsc --noEmit && vitest run
pnpm build      # 产物在 dist/
pnpm watch      # 监听重建
pnpm smoke      # 真机冒烟（Chromium + 本地 mock LLM）
pnpm timing     # 计时诊断，可 DELAY=1500 pnpm timing
```

`pnpm smoke` 默认自动找 Chromium（`CHROME_PATH` > 系统 Chromium > Playwright 缓存）。装的是 Chrome 而不是 Chromium 时，冒烟会因为 `--load-extension` 被禁用而失败，这是预期行为。

## 提交前

1. `pnpm check` 必须全绿；
2. 改到 UI / 交互的，跑一次 `pnpm smoke`，确认 11 个场景全过；
3. 改了正文提示或设置项的，顺手更新 README 与 REQUIREMENTS。

## 代码约定

- TypeScript 严格模式，不引入运行时框架（内容脚本零运行时依赖）；
- 页面 UI 全部走 Shadow DOM（`attachShadow`），不要污染站点样式；
- 所有出网请求只能从 background service worker 发；
- 注释解释“为什么”，不写“是什么”；
- 不要破坏这几条红线：
  - 一次用户动作 = 一次翻译请求；
  - 标记不自洽时整段降级，不重试；
  - 输入框翻译点击即替换，不弹预览；
  - 密码/银行卡字段不碰。

## 提交信息

简洁即可，例如：

```
fix: 标记越界时整段降级
feat: 输入框选中翻译
docs: 补充隐私说明
```

## 安全

不要在提交里带 API Key、个人路径、`.env`。API Key 只存在用户本地的 `chrome.storage.local`。
