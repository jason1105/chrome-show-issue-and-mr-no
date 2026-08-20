## #15 派工记录更新 —— 路径 C 双兜底确认（manager，run7 实锤后）

**裁定**：路径 C = onInstalled（扩展升级）+ onStartup（纯重启）双兜底，为终态方案。此前「onInstalled 即终态」基于 run4 证据不足推导，run7（补丁在位 + SW console 采到早期 boot 日志，onInstalled 未触发）修正为双路径兜底。

**manager 代码核验补充（对方案的一处事实修正）**：
- 当前主工作区与 .acc1-main 的 `src/background.js:59-63` onStartup 监听器**已调用 `syncRegisteredScripts()`**，并非「仅打日志不调 sync」——真正缺口是：① 无插桩日志，无法判定 onStartup 是否触发；② 无 catch 兜底，sync 失败静默丢失。因此 onStartup 补丁实质 = 补三处插桩日志，无需新增 sync 调用。
- 已核验 `syncRegisteredScripts()`（permissions.js:100-130）为幂等操作（unregister → register，无权限弹窗），重复调用安全。

**@dev 派工（红线不变）**：
1. `.acc1-main/src/background.js` onStartup 监听器补插桩：
   - 入口 `console.log('[SW] onStartup triggered')`
   - `syncRegisteredScripts().then(() => console.log('[SW] onStartup: syncRegisteredScripts done'))`
   - `.catch(err => console.error('[SW] onStartup sync failed:', err))`
   - onInstalled 补丁（update/chrome_update 分支）保持不动
2. `npm run test` 全绿
3. 干净复跑验收（沿用 run7 采集端）：删 `<profile>/Default/Scripting.json` → 重启 Chrome
4. #15 comment 留痕 SW console 全文 + 关键字段，落款 dev

**验收判据（run8）**：post SW console 须有 `[SW] onStartup triggered` + `[SW] onStartup: syncRegisteredScripts done`，无 `sync failed`；注册恢复 2 条（MAIN/ISOLATED、persistAcrossSessions: true）+ badge `Issue #123`。判定点 20s 轮询，断言不放宽。

**升级路径（预埋）**：若 run8 无 `[SW] onStartup triggered` 日志，则实锤 graceful quit + relaunch 下 onStartup 不触发 → 提交 architect 评估方案 D（SW 顶层 boot 无条件 sync；幂等性已核验可行）。

**@test**：复跑前校验 onStartup 插桩在位；按新口径（有 `onStartup triggered` 日志）独立验收。

—— manager
