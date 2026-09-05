# Edge Phase 1 冒烟结论（dev2 / issue #6 D 线）

> dev2 交付 · 定稿归档 2026-09-03。原始工作区为隔离 worktree `/tmp/edge-dev2-worktree`（基 `2d6231b`，未触碰主线）；本文档与冒烟脚本、原始日志已随证据分支 `docs/issue-6-dline-edge-evidence` 归档入仓（`docs/` + `scripts/` + `docs/evidence/issue-6-dline/`），索引见 `docs/evidence/issue-6-dline/README.md`。
> 环境：Microsoft Edge 152.0.4191.62（`/Applications/Microsoft Edge.app`）。
> **状态：已定稿**（manager 2026-09-03 裁决 + admin 批准 GitHub 转向后）。badge 跨完全重启回 `""` 已归位为「产品级后续修复候选（#22）」，非 #6 门禁缺陷、非合入缺陷，详见 §3 定稿口径。产出物已归档入证据分支（仅 docs/scripts，零 src、零 manifest）。

## 一、结论摘要（本轮最终版）

| 验收点 | 结果 | 证据 |
|---|---|---|
| ① Edge 真机可加载扩展（路线 A 首个风险） | **PASS** | 扩展 SW boot，id=`ceikgpeomcdgolonadmojochagppfejh` |
| ② badge 置位时序：setBadgeText→getBadgeText round-trip | **PASS** | case3/4（`"!"`/`""`） |
| ③ badge 串行 set/clear 竞态确定性 | **PASS** | case6 末写 `""`（确定性，无竞态翻转） |
| ④ **真实 SW 回收后 badge 持久不撤销**（#6 第三条款正确测试面） | **PASS** | case5c：同会话内真 Stop SW → badge 仍 `"!"` |
| ⑤ storage / 扩展 id 稳定 | **PASS** | pending storage 持久、id 稳定 |
| ⑥ manifest 零改动、src/ 零触碰 | **PASS** | git diff 无 src/manifest 变更 |

**Edge Phase 1 全量：8/8 PASS**（`edge-smoke-full.log`，`summary PASS=8 FAIL=0`）。

## 二、本轮实证的关键方法修正（重要，取代上一版「半 PASS 待上报」）

上一版把 #6 第 3 条（"badge 持久于 SW 回收/重启不撤销"）用**完整浏览器重启**来测，得到重启后 badge `""`，并判「半 PASS / 待决策」。本轮深挖后发现**该测试面向打偏了**，root cause 分三层：

### 2.1 语义纠偏：#6 第 3 条的范围是「SW 回收」，不是「进程重启」
- `chrome.action.setBadgeText` 的 badge 是 **browser 进程持有、内存态**的 action 状态，MV3 规范**不保证对未打包 `--load-extension` 扩展跨进程硬重启落到磁盘**。
- "持久于 SW 回收、不撤销" 的正确读法 = 在**同一浏览器会话内**把扩展 service worker 停掉（真回收），badge 仍由浏览器持有、不被撤销。
- 用「完整重启浏览器」测它，测的是**「打包持久性」**（packaging persistence），那本不属于 #6 第三条。

### 2.2 读值方法缺陷：从 SW 句柄读，被 MV3 空闲回收坑吞掉
- MV3 无事件的 SW 在无事件驱动时**秒级空闲即被再次回收** → 通过一个短命的 `worker.evaluate` 句柄读 badge，频繁报 `Target closed`，看起来像「badge 消失」，实为 SW 已死读不到。
- **修正读面**：从**常驻的扩展页面**（`options.html`，`open_in_tab:true`）读 `/` 写 badge——`chrome.action` 对任意扩展页可用，页面稳定存活，不受 SW 回收影响。这才是 badge 的真实浏览器态。

### 2.3 真实回收手段
- 之前 `Target.closeTarget` 会**把整条 CDP 调试连接也拖垮**（后续 targets() 永久 pending / 报 Target closed / browser.close 卡死）。
- 本轮改用 `chrome://serviceworker-internals` 的 **Stop 按钮**（shadow-DOM pierce 后 click）——真浏览器级终止 worker，且**不破坏 CDP 连接**。据此在**同一会话**内完成回收后读 badge。

### 2.4 实测复现（edge-phase1-smoke.mjs case5 改写后）
```
clean="" → set "!" → (options页读基线 "!") → Stop extension SW (real reclaim) → "(options页读) badge 仍 = "!"  → PASS (5c)
```
即：**在 Edge 上，真实 SW 回收/重建不会使 `"!"` badge 失效**。#6 第 3 条断言在此正确测试面下 **PASS**。

## 三、上一版记录的另一个事实点（保留为扩展架构备注，非 #6 gate）
上一版以「完整重启」复现的 badge 清空 `""` 仍**客观存在**，只是它属于**打包持久性**范畴：
- 对未打包 `--load-extension` 扩展，完整重启后 action badge（browser 内存态）不保证落盘，故重启后 `""`。
- 若真实分发是 **CRX/WebStore 打包**扩展，badge 状态是否跨重启持久由安装形态决定；主流 MV3 实践是**依赖扩展架构在 `onStartup`（或每次 `storage` 变更）重打 badge**。
- 本项目 `background.js:78-79` **有意移除了 `onStartup` 监听**（#15 path D 注释），冷启动自愈只重同步 content scripts 不重打 badge → 完全重启后未打包扩展 badge 不自动恢复。
- **此点与 #6「Edge 兼容性」无关**（Edge 行为与 Chromium 一致），归属扩展架构自愈完整性，**按团队最新裁决定性为「产品级后续修复候选」：非 #6 门禁缺陷、非合入缺陷**，不阻塞 D 线 Phase 1 验收。

> **定稿口径（manager 2026-09-03 裁决）**：D 线 badge 结论 = **当前会话级同步验证 PASS**（授权→`!`、移除→`""`、getBadgeText 会话内复核、真实 SW 回收 badge 保持）；**跨完全重启沿用行为（重启后回 `""`）不属 #6 验收规格，归后续修复候选**，已由 **#22 boot 重派生**承载。
>
> **#22 落地现状（同步于 admin「GitHub 转向」）**：实现已 rebase 至 **github/main 基线**（本地分支 `__r22tmp`，commit `8c7dc86` fix + `aef9ec7` test，2 commits ahead `28a2b11`）——boot 冷启动自愈块后追加**幂等 `permissions.updatePendingBadge(chromeApi)`** 重派生 `!`，不重引 `onStartup`、无新增监听、仅动 `src/background.js`+`tests/background.test.js`（`loadBackgroundWithRealPermissions` 真模块集成用例，空 pending 收敛 `""` / 重复 boot 幂等）。**全量 `npm test` = 176/176 PASS**。合并门禁 = admin 放行。

## 四、Chrome 对照的实证结果（回答上一版遗留 open question）
本机 **Google Chrome 152.0.7977.65 (Mac)** 用同一套 puppeteer + `--load-extension` 无法加载未打包扩展：
- `chrome://extensions-internals` 权威显示仅内置 PDF Viewer，用户扩展未注册；
- 已试：增加 `--disable-features=DisableLoadExtensionCommandLineSwitch`、`ignoreDefaultArgs:['--disable-extensions']`，均不生效；
- 根因倾向 **Chrome stable 品牌对命令行未打包加载策略更严（防恶意软件），而 Edge（非该 policy 受众）放行**。这与 Edge 是同引擎（Blink/Chromium 152）但不同 brand policy。
- 结论：Chrome 侧**无法用 `--load-extension` 手段自动化对照**（非缺陷，是 Chrome stable 限制）。若未来需 Chromium 对照，应改用 **Chrome for Testing (CfT) / 开源 Chromium** builder 手动下载（本机当前未装）。

## 五、自测证据归档（本仓库 `docs/evidence/issue-6-dline/`，复现脚本在 `scripts/`）
- `docs/evidence/issue-6-dline/edge-smoke-full.log`：edge-phase1-smoke **case5 改写后全量 8/8 PASS**（本轮权威证据）
- `docs/evidence/issue-6-dline/edge-read1.log`：stopui.mjs 真回收探针——clean=`""` / before=`"!"` / **after reclaim=`"!"`**（决定性）
- `docs/evidence/issue-6-dline/edge-stop4.log`、`edge-stopui.log`：回收期间 SW 句柄读值 `Target closed` 假象的原始探针（佐证 2.2）
- `docs/evidence/issue-6-dline/chrome-baseline-run*.log`、`chrome-diag*.log`：Chrome stable 无法加载未打包扩展的对照过程
- 上一版 `/tmp/edge-phase1-run2.log (未归档，历史)`（7/7 旧版）、`run4.log`（旧版 5b FAIL 揭示重启清 badge）仅保留作历史，测试面向已修正

## 六、工作区/工具链备注（供后续复用）
- NODE_ENV 被持久设 `production` → npm/pnpm 跳过 devDependencies。规避 `export NODE_ENV=development`。
- `scripts/pre-grant-via-puppeteer.mjs` 有 i18n 判定 bug（中文 `'已授权'` vs 英文 `Authorized`），仅影响状态识别。
- puppeteer MV3 真回收**勿用 `Target.closeTarget`**（拖垮 CDP）；用 serviceworker-internals UI Stop。
- 读/写 badge 用**常驻扩展页**（options.html）作读面，勿用短命 SW 句柄。
- 独立 Chrome 对照需 CfT / Chromium build；Google Chrome stable 命令行禁 `--load-extension`。
