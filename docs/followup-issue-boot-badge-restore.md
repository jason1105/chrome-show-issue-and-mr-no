# Follow-up：冷启动 boot 重打 badge（跨重启 badge 生命周期缺口）

> manager 立项留档 · architect 根因与方案 · 发现者 dev2（Edge 实测）· 校验 test
> 2026-09-03。本文为独立决策与派工记录，不并入 C/B/D 任一既有 commit/分支，不入 MR 排除清单之外的任何产物。

---

## 一、现象与证据

- **Edge 双脚本×2 独立复现**：同一 profile 第二次 launch（完全重启）后，`chrome.action.getBadgeText({})` 由 `"!"` 归零为 `""`。
- 扩展 id 与 `storage.local` **均跨重启持久**——排除「profile 丢失 / 重装换 id / `--load-extension` 整体失败」。
- 非 SW 空闲回收：实测 `sw.close()` 后 attempt 恒为 1，SW 未真回收，该腿未真测到。钉死的是「**浏览器完全重启**」这一形态。

## 二、架构判定（architect，已逐行核实代码）

1. **官方语义**：`chrome.action` 全局 badge 文本（无 tabId）是**浏览器进程内存态**，keys 到扩展、**不落 profile**。同内核 Chrome/Edge 一致 = 预期 Chromium 行为。unpacked vs CRX 为伪变量（引擎持久化语义不随打包方式变）。
2. **两生命周期区分**：SW 空闲回收（进程仍活→badge 通常保留）≠ 浏览器完全重启（进程态丢→badge 归零）。
3. **代码事实**：
   - 冷启动自愈块 `background.js:26-36` 只 `syncRegisteredScripts()` 重注册 content script，**从不调 `updatePendingBadge`**。
   - `updatePendingBadge` 调用点全在权限事件内（`requestOrigin` / `removeOrigin` / `onInstalled-update`），无 boot 重打。
   - `onStartup` 被 #15 路径 D 刻意移除（`:78-79`），只覆盖 relaunch、非全部重启形态。
4. **根因**：pending 真源在 `storage.local`（持久可靠），badge 是派生视图；缺「boot 重算」一环 → 重启后 storage 有 pending、badge 空，用户该见待授权 `!` 却不见。真 bug 级产品缺口。

## 三、归属与红线（manager 拍板）

- **此缺口不属 D 线 Phase 1**（#6 加载/权限 round-trip/时序已过），**不因本条给 D 线 FAIL**。
- 修复落 `src/background.js`（+可选 `src/permissions.js` 复用点）→ **C 线 owned**，修 owner=@dev，**D 线零 src 红线继续守住**（dev2 不碰 src/）。
- 独立立项，与 PR #15 合并门禁**并行走**，不因 #15 未合而阻塞派工与实现路线。

## 四、修复建议（architect，最小侵入，供 dev 实现参考）

在现有冷启动自愈块内、`syncRegisteredScripts` 之后追加：
`permissions.updatePendingBadge(chromeApi)`

- `updatePendingBadge` 幂等、已导出（`permissions.js:257`），现成一次调用即可。
- 覆盖 relaunch / reload / idle 唤醒 / 完全重启 **全部重启形态**。
- 零新增生命周期监听，不悖 #15 移除 onStartup 的设计（不复用 onStartup，走统一 boot 路径）。
- 不改「onStartup 移除」决策，只补 boot 派生重算。

## 五、验收口径修订建议（需 admin/manager 拍板后 @test 同步）

- 对比仓库已提交 `docs/edge-smoke-and-badge-css-split.md` §4：三断言只有「授权→!/移除→空/`getBadgeText` 断言」，**从未要求 badge 跨完全重启持久**。
- 既有「跨 SW 回收也持久」为执行期中途**超规格**叠加，且 Chromium 语义上对「完全重启」不可能成立，会错误卡死 D 线。
- 产品真不变量应为：**「pending storage 持久 + boot 重派生 badge」**，而非「badge 文本跨重启魔法般持久」。
- 建议 baseline §五 #6 验收 2 条修订为：badge 待授权时显示 `!`、授权后清空、`getBadgeText` round-trip 通；badge 冷启动由 storage 重派生存活（配合本条修复后验证）。

## 六、待办推进（manager 派工，@next who）

- [ ] `#6` 主线 PR #15 合入（@admin 放行）后，C 线 rebase 提 MR。
- [ ] C 线后续 commit：实现 boot 重打 badge（本条修复，owner=@dev）。
- [ ] @test 对「修复后 boot 重派生 + 完全重启 badge 存活」复测，留痕 PASS/FAIL。
- [ ] @admin 拍板 baseline §五 #6 验收口径修订。

—— manager 立项留档
