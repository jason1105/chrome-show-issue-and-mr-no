# D 线（issue #6）Edge Phase 1 冒烟证据归档

> 归档人：dev2 · 2026-09-03 · 环境详见结论文档 `docs/edge-phase1-conclusion-dev2.md`。
> 目的：把 `/tmp` 交付物落仓到房间可读路径，供 @test 独立复核四定桩，不留 `/tmp` 依赖。

## 一、文件清单与四定桩映射

| 文件 | 生产脚本 | 支撑的定桩 |
|---|---|---|
| `edge-smoke-full.log` / `edge-smoke-full2.log` | `scripts/edge-phase1-smoke.mjs` | 断言桩：全量 8/8 PASS（两次独立运行复现，含 case5c） |
| `edge-read1.log` | `scripts/stopui.mjs` | 断言桩（决定性单条）：真回收后 `afterReclaim="!"` |
| `edge-stopui.log` | `scripts/stopui.mjs` | 方法论桩：SW 句柄读值 `Target closed` 假象原始记录 |
| `edge-stop4.log` | （弃用手法，仅存档） | 方法论桩：`Target.closeTarget` 拖垮 CDP 的原始记录 |
| `chrome-baseline-run1/2.log`、`chrome-diag7.log` | （Chrome 对照过程） | Chrome 基线桩：stable 152 无法 `--load-extension` 加载未打包扩展 |
| `docs/edge-phase1-conclusion-dev2.md`（上级目录） | — | 平台语义桩：§2/§3（SW 回收 ≠ 完整重启两边界） |
| `edge-idle-evidence.json` + `edge-idle-probe-run.log` | `scripts/edge-idle-wake-probe.mjs` | **#22 idle 收口**：自然回收（30.0s）→ 唤醒前 badge 已清 `""` + pending 非空 → 唤醒后 boot 重派生 `!`（决定性）；pending=[] + 幽灵 `!` → 唤醒收敛 `""`。加载源 = `__r22tmp` @ `aef9ec7` |

平台语义桩的独立复测入口 = `scripts/edge-badge-persist-diag.mjs`（输出 S1 boot / S2 write / S3 restart 三态，直接观察跨重启 badge 归零与 id 稳定性）。

## 二、复现命令

前置：本机装有 Microsoft Edge（`CHROME_PATH` 指向其可执行文件）、`node_modules/` 已安装（`puppeteer-core` 为 devDependency；若 `NODE_ENV=production` 先 `export NODE_ENV=development` 再安装）。

```sh
# 1. 全量冒烟（8 用例，两次运行复现 PASS=8）
CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  node scripts/edge-phase1-smoke.mjs

# 2. 真 SW 回收探针（决定性读值，期望 afterReclaim="!"）
CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  node scripts/stopui.mjs

# 3. 跨重启边界探针（平台语义桩，期望 S3 badge 回 ""、id 稳定）
CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  node scripts/edge-badge-persist-diag.mjs

# 4. #22 idle 收口探针（自然回收+唤醒重派生+幽灵收敛，见 edge-idle-evidence.json）
#    加载源须为 #22 分支（boot 重派生块存在），基线分支无此块：
#    git worktree add --detach /tmp/r22-load __r22tmp   # @ aef9ec7
CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  node scripts/edge-idle-wake-probe.mjs
```

注：日志归档为 2026-09-03 本机运行原始输出，非重跑生成；复测以命令现跑结果为准。

## 三、口径提醒（复核时勿混淆）

- **case5c PASS 只验证「进程内 SW 回收后 badge 存活」这一边界，不是 #22 生效证据**（architect 裁定）。
- **跨完整重启 badge 归零** 属平台语义边界（浏览器内存态不落盘），非 #6 门禁缺陷，产品级恢复由 #22 boot 重派生承载。
- Chrome stable 侧无法用 `--load-extension` 自动化对照是环境限制，如需 Chromium 对照应改用 Chrome for Testing。
