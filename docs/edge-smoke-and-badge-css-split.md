# #6 Edge 冒烟实施要点 + BADGE_CSS 拆分结论

> architect 交付 · 供 @manager 派工、@dev2 落地、@test 对验收。
> 结论均基于仓库代码事实核实（2026-09 现状），非文档臆测。

---

## 一、BADGE_CSS 拆分结论（已完成，非待办；#11 已派工）

**结论：不抽独立 `.css` 文件，抽独立 `src/badge-css.js` 常量文件，UI 独占该文件，dev 独占 `src/ui.js`。零文件冲突，不动构建与分发模型。**

### 状态：已完成（非待办）

Step 0 拆分已由 dev 完成并多轮复核 PASS：
- GitLab 侧 `2d6231b`（parent `76fe029`），GitHub 侧 `52732b1`（parent `28a2b11`）。
- BADGE_CSS 逐字节一致（18552 字符，为 Step 0 时点快照；现 `origin/main` 已随 #24 B2 合入增至 22312 字符）。
- `src/badge-css.js` 868 行，UMD 挂 `root.GitLabReferenceBadgeCss`；`src/ui.js` 110 行，BADGE_CSS 残留 0。
- `npm test` 170/170（GitHub main 基线）/ 171/171（GitLab main 基线）。
- 合并状态：GitHub 侧 `52732b1` 已为 `origin/main` 祖先；GitLab 侧 `2d6231b` 尚未合入 main（合入须 admin 明确指令）。Step 0 本身无待开发工作。

**#11 / #6 派工现状（拆分已完成，勿按旧口径重派）：**
- #11 已派工：B 线 UI B1 已提交 `f27cd6a`（对比度 3 处 + load-more `:focus-visible` 补漏 + options.css 深色 `.status` 补齐，171/171），C 线任务单已预发 dev。
- #6 Edge Phase 1 归 **dev2**（不是 dev，dev 只做 #11 逻辑），待 Step 0 合入 main 后给并行令；冒烟本身是 D 线交付物，不是 D 线前置。

### 为什么不能抽 `.css`

1. CSS 是「文本同步注入 shadow root」，不是 `<link>`：`src/content.js:1809` `style.textContent = badgeCssApi.BADGE_CSS;`。
2. content script 是零构建零打包纯 JS 顺序注入（`src/permissions.js:14-21` `CONTENT_SCRIPT_FILES` 按 parser→config→i18n→badge-css→ui→content 顺序 document_start 注入，每文件 UMD 双轨挂 `root.GitLabReferenceXxx`）。
3. `manifest.json` **没有** `web_accessible_resources`、**没有** `content_security_policy` 自定义。外置 `.css` 走 `<link rel="stylesheet">` 或 `fetch` 需要 WAR + 打包器，破坏「零依赖 zip 分发」模型。

### 主题探测归属边界（关键，避免 UI/dev 误抢）

- CSS 侧：`src/badge-css.js:726` 已含 `:host([data-theme="dark"])` 深色消费块（#24 新增，PR #26 已合入 `origin/main` `40f26b6`）；`src/badge-css.js:595` `@media (prefers-color-scheme: dark)` 作为系统深色**回退分支保留**。**UI 第二波已完成为 #24，无剩余待办**。若后续仍需调整 `:host` 三态，归 **UI**。
- 「探测 GitLab 主题（`gl-dark` / `data-theme`）并给 host 打 `data-theme` 属性」的 JS → **dev（C 线）**。
- 属性名固定 `data-theme`，确定性默认值，不留无属性悬浮态，禁自造别名。
- `src/options.css` 是扩展自有页面，**不跟随 GitLab 主题**；其系统深色分支（`:86`）保留，走扩展/OS 偏好，**归 @UI 维护**（options.css 为 UI 独占文件）；dev C 线的 `data-theme` 探测**不触碰** options.css。

### 已发现无需重复劳动的点

`BADGE_CSS` 内已有 `:focus-visible` 多处——#11 焦点可见性是「补漏」非「从零」。

---

## 二、#6 Edge 差异表（manifest / API / CSP 三块）

> ⚠️ **本节 Firefox 列非 Wave 1 范围，仅素材**：SW→event page 分叉、`browser.*` Promise 语义、`world:'MAIN'` CSP、`gecko.id`、optional host permissions 授权流差异——全部收敛为未来 Firefox 架构决策 issue 的素材库，Wave 1 不动、不预决策 background 形态。Edge 列全绿，佐证 D 线（dev2）零改码冒烟可行。

### 2.1 manifest 差异

| 字段 | 现状（`manifest.json` 实测） | Chrome | Edge | Firefox | 结论 |
|---|---|---|---|---|---|
| `manifest_version` | `3` | ✅ | ✅ | ⚠️ MV3 支持但部分 API 缺 | Edge 零改 |
| `background.service_worker` | `"src/background.js"`（`:22-24`） | ✅ | ✅ | ❌ 不支持 SW，需 event page（`background.scripts`） | Edge 零改；Firefox 延后 |
| `action` | `{}`（空对象，`:21`） | ✅ | ✅ | ✅（`browser_action` 语义） | Edge 零改 |
| `optional_host_permissions` | `http://*/*`、`https://*/*`（`:17-20`） | ✅ | ✅ | ⚠️ 授权流/通配行为有差异 | Edge 零改 |
| `content_scripts` | **无**（走动态注册） | ✅ | ✅ | ✅ | Edge 零改 |
| `web_accessible_resources` | **无** | ✅ | ✅ | ✅ | Edge 零改 |
| `browser_specific_settings.gecko` | **无** | N/A | N/A | ❌ 必需（Gecko ID） | Firefox 立项时补 |

**结论：Edge Phase 1 是纯验证，现有 manifest 用 Chromium 标准 MV3 字段，Edge 同为 Chromium 内核，全部原生支持，`manifest.json` 零字段改动。** dev2 无需改 manifest；若冒烟中确需字段级微调，报 manager 派给对应 owner，dev2 不碰 `src/`。

### 2.2 API 差异

| API | 现状（代码实测） | Chrome | Edge | Firefox | 结论 |
|---|---|---|---|---|---|
| `chrome.action.setBadgeText` / `setBadgeBackgroundColor` | `src/permissions.js:54-65` | ✅ | ✅ | ⚠️ `browser.browserAction.setBadgeText` | Edge 零改 |
| `chrome.scripting.registerContentScripts`（动态注册） | `src/permissions.js:131` | ✅ | ✅ | ❌ 不支持（Firefox 需静态 content_scripts 或 `browser.scripting` 有限支持） | Edge 零改；Firefox 是主要差异点 |
| `chrome.permissions` optional host 授权 | `src/permissions.js:137-166` | ✅ | ✅ | ⚠️ 授权流/持久化差异 | Edge 零改 |
| `chrome.runtime.openOptionsPage` | `src/background.js:105` | ✅ | ✅ | ✅ | Edge 零改 |
| `importScripts`（SW 内） | `src/background.js:6-8` | ✅ | ✅ | ❌ event page 不支持 SW 专属 importScripts | Edge 零改；Firefox 延后 |

**结论：Edge 与 Chrome 同内核，上述 API 语义完全一致，D 线零代码改动。** 真正的 API 差异集中在 Firefox（`registerContentScripts` 缺失、SW→event page、`importScripts` 不可用），全部属于已拍板延后的 Firefox 议题素材，任何人不对 background 形态做方案预决策。

### 2.3 CSP 差异

| 项 | 现状 | Chrome | Edge | Firefox | 结论 |
|---|---|---|---|---|---|
| 扩展页 CSP | MV3 默认 `script-src 'self'; object-src 'self'`（未自定义） | ✅ | ✅ | ⚠️ MV3 下 CSP 行为有差异 | Edge 零改 |
| 样式注入方式 | `style.textContent = badgeCssApi.BADGE_CSS`（`content.js:1809`），shadow root 内 DOM 写入 | ✅ | ✅ | ⚠️ content script 在 shadow root 内 inline style 行为待实测 | Edge 零改；Firefox 延后 |

**结论：本扩展不依赖扩展页 CSP 例外——样式走 `style.textContent` DOM 注入，不走 `<link>`/`fetch`，不触碰 `web_accessible_resources`。** Edge 与 Chrome 的 content script CSP 行为一致；Firefox 的 shadow root inline style 差异属延后议题，立项时实测，本文不写死。

---

## 三、Edge 加载方式与冒烟路线

### 本机环境现状（architect 实测核实）

| 项 | 状态 |
|---|---|
| Edge | ❌ 未安装（`/Applications` 与 `~/Applications` 均无） |
| msedgedriver | ❌ 未安装 |
| chrome-for-testing 缓存（150.0.7871.124） | ❌ 本机无此缓存 |
| chromedriver | ❌ 不在 PATH |
| Chrome stable | ✅ `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| brew | ✅ 可用 |

**结论：本机当前无法直接跑 Edge 冒烟，需先装 Edge + msedgedriver。**

### 两条冒烟路线（选 A，改动最小）

**路线 A（推荐）：puppeteer-core + `--load-extension`（CDP，引擎无关）**

现有 `scripts/pre-grant-via-puppeteer.mjs` 用 `puppeteer-core` 驱动任意 Chromium，`executablePath` 已支持 `CHROME_PATH` 环境变量覆盖（`:35`），且内置 `--disable-extensions-except` + `--load-extension`（`:70-71`）。Edge 同为 Chromium，CDP 完全一致：

```bash
brew install --cask microsoft-edge

CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  node scripts/pre-grant-via-puppeteer.mjs "http://127.0.0.1:PORT" "$(mktemp -d /tmp/edge-profile-XXXX)"
```

零改码，直接复用。

**路线 B：WebDriver BiDi（`goog:chromeOptions` 需换 `ms:edgeOptions`）**

`tests/browser.test.js` 与两条本地冒烟脚本（`package-smoke.mjs` / `acceptance-issue20.mjs`）均硬编码 `goog:chromeOptions` 能力键。Edge 驱动（msedgedriver）官方键是 `ms:edgeOptions`。要跑 Edge 需改：

- `tests/browser.test.js`：`createWebDriverSession` 的能力键 `'goog:chromeOptions'`（`:191`）及其 `debuggerAddress` 读取（`:648`）
- `scripts/package-smoke.mjs`：`main()` 内 `alwaysMatch` 的 `'goog:chromeOptions'` 能力键（`:83`）及其 `debuggerAddress` 读取（`:88`）
- `scripts/acceptance-issue20.mjs`：`newSession()` 内 `alwaysMatch` 的 `'goog:chromeOptions'` 能力键（`:67`）及其 `debuggerAddress` 读取（`:77`）

> 注：`scripts/package-smoke.mjs` / `scripts/acceptance-issue20.mjs` 为本地冒烟脚本，当前未纳入 `origin/main` 版本库（脚本入库跟进见 issue #31）。上列函数名/能力键名定位仍可唯一锚定到本地对应实现，待脚本入库后行号以入库版本为准。

> 注：`tests/browser.test.js` 的 `findExecutable` 已支持 `CHROME_PATH` / `CHROMEDRIVER_PATH` 环境变量覆盖，但光靠环境变量不够——能力键硬编码是真正的拦路点。

---

## 四、`action.setBadgeText` MV3 时序/竞态验证点

### 现状（代码实测）

- `updatePendingBadge`（`src/permissions.js:52-67`）：先 `readPendingOrigins()`（异步 `storage.local.get`），再根据 pending 长度决定 `setBadgeText('!')` 或 `setBadgeText('')`，并 `setBadgeBackgroundColor('#c62828')`。
- 调用点：`requestOrigin` 授权成功后（`:155`）、`removeOrigin` 移除后（`:183`）、`migrateLegacyOriginsOnUpdate` 迁移后（`background.js:78`）。

### 时序/竞态风险（理论，需 Edge 实测钉死）

1. **异步读后写**：`readPendingOrigins` 是异步 storage 读，`updatePendingBadge` 先读后写。单次操作内部是串行 Promise 链，无竞态；但**跨操作并发**（如快速连续授权 + 移除）时，可能「旧读覆盖新写」，badge 状态短暂错乱。
2. **授权成功后写 pending 再清 pending**：`requestOrigin` 成功路径先 `writePendingOrigins` 过滤掉该 origin（`:152-154`），再 `updatePendingBadge`（`:155`）——顺序正确，但依赖 storage 写入完成，需实测确认无竞态窗口。

### Edge 冒烟验证点（issue #6 点名的差异）

Edge 与 Chrome 同内核，`action.setBadgeText` / `setBadgeBackgroundColor` 语义一致——issue #6 的「时序差异」是理论风险，真实验证点是：

1. 授权后 badge 出现 `"!"`；
2. 移除后 badge 清空；
3. **用 `chrome.action.getBadgeText({})` 断言返回值**，而非只看 UI 目视。

---

## 五、Edge 冒烟验收建议

沿用 `tests/browser.test.js` 的 fixture server 模式（`127.0.0.1` 本地 origin，不依赖真实 GitLab 网络），跑通主流程即算 Phase 1 通过：

1. 授权（`chrome.permissions.request`）→ 2. 动态注册（`getRegisteredContentScripts` 长度 > 0）→ 3. 导航到 fixture 页 content script 注入 → 4. 拷贝 → 5. 开面板 → 6. 跳转。
