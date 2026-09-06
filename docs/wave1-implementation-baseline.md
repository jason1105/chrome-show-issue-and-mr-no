# Wave 1 实施基准（#11 无障碍 + #6 Edge Phase 1）

> architect 交付 · manager 拍板版固化 · 2026-09-03
> 本文是 Step 0 之后三线并行及后续波次的**唯一实施基准**。行号均已按 `origin/main`（=`40f26b6`，#24 已合入后的源码状态）实测核对，非拆分前旧号。

---

## 一、现状快照（已核实，非待办）

| 项 | 实测 |
|---|---|
| `src/badge-css.js` | 已存在，868 行（`wc -l`），UMD 挂 `root.GitLabReferenceBadgeCss`，导出 `{ BADGE_CSS }` |
| `src/ui.js` | 110 行，BADGE_CSS 残留 0 处，仅剩图标工厂（COPY_ICON_PATHS / SUCCESS_ICON_PATHS / createDragHandleIcon 等） |
| `src/content.js:26` | `const badgeCssApi = root.GitLabReferenceBadgeCss;` |
| `src/content.js:1809` | `style.textContent = badgeCssApi.BADGE_CSS;` |
| `src/permissions.js:14-21` | `CONTENT_SCRIPT_FILES` 顺序 parser → config → i18n → **badge-css** → ui → content |
| `src/badge-css.js:595` | `@media (prefers-color-scheme: dark) {`（系统深色回退分支，**保留**；#24 B2 三态合成为**新增** `:host([data-theme="dark"])` 深色块 `:726`，PR #26） |
| `src/options.css:86` | `@media (prefers-color-scheme: dark) {`（系统深色分支，保留） |
| 测试 | 186/186（origin/main 基线，含 #21 config + #26 合并增量） |

**Step 0 拆分已完成**：GitLab 侧 `2d6231b`（parent `76fe029`）、GitHub 侧 `52732b1`（parent `28a2b11`），BADGE_CSS 逐字节一致（18552 字符，为 Step 0 时点快照；现 `origin/main` 已随 #24 B2 合入增至 22312 字符），manager/dev/architect 三方独立复核 PASS。**Step 0 本身无待开发工作**；其中 `52732b1` 已为 main 祖先，GitLab 侧 `2d6231b` 尚未合入 main（合入须 admin 明确指令）。

**合并路径（manager 已拍板）**：GitHub PR #15 为正式入口，GitLab MR !27 仅镜像同步、不作决策载体。合入须 admin 明确指令（红线）。

**B 线状态（UI B1 → B2）**：B1 提交于 `2d6231b` 之上（`f27cd6a`，净改动 2 文件 +8/−5，已推 GitLab origin）。B2（新增 `:host` 三态合并选择器 `:726`，保留 `:595` `@media` 回退）已完成为 **#24**（PR #26，已合入 `origin/main` `40f26b6`）。

---

## 二、拆分定案（最终结论，不再讨论）

- **抽 `src/badge-css.js`**（JS 常量文件），**不抽 `.css`**。
- 理由（均已核实）：
  1. CSS 是「文本同步注入 shadow root」，不是 `<link>`：`content.js:1809` `style.textContent = badgeCssApi.BADGE_CSS`。
  2. content script 是零构建零打包纯 JS 顺序注入（`permissions.js` `CONTENT_SCRIPT_FILES`），每文件 UMD 双轨挂 `root.GitLabReferenceXxx`。
  3. `manifest.json` **无** `web_accessible_resources`、**无** `content_security_policy`；外置 `.css` 走 `<link>`/`fetch` 需 WAR + 打包器两样现在都没有的东西，破坏「零依赖 zip 分发」模型。
- **BADGE_CSS 完全静态**：`${` 插值 0 次；`var(--reference-*)` 是 CSS 自定义属性，由 `content.js` 在 host 上 `style.setProperty` 赋值（`:512/:516/:529/:533/:548-550`）。

---

## 三、文件归属（manager 放行版，钉死，冲突口径一律以此为准）

| 线 | 文件范围 | 负责 |
|---|---|---|
| B（#11 视觉） | `src/badge-css.js` + `src/options.css` | @UI |
| C（#11 逻辑） | `src/ui.js` + `src/content.js` + `src/config.js` + `src/permissions.js` + `src/background.js` | @dev |
| D（#6 Edge Phase 1） | `manifest.json`（仅字段级微调如需）+ 冒烟脚本 + `docs/`，**不碰 `src/`** | @dev2 |
| 文档 | `docs/` | @architect |

---

## 四、三线内容与边界

### B（@UI，第一波 B1 已交付并冻结，第二波 #24 已合入 main）
- 对比度 4.5:1（`badge-css.js` + `options.css`）
- `:focus-visible` 补漏（只补缺，不改已有实现）
- 空态/骨架视觉
- **第二波（已完成 #24，PR #26 已合入 `origin/main` `40f26b6`）**：新增 `:host` 三态合并选择器（`dark`/`light`/无属性兜底，`:726`），并保留 `badge-css.js:595` `@media (prefers-color-scheme: dark)` 系统深色回退分支

### C（@dev，等合并信号）
- 主题探测：探测 GitLab `gl-dark`/`data-theme`，给 shadow host 打 `data-theme="dark"|"light"`，确定性默认值，不留无属性悬浮态；属性名固定 `data-theme`，禁自造别名。
- 键盘：全键盘走通「拷贝→开面板→搜索→跳转」，焦点陷阱 + roving tabindex。
- ARIA：toast `aria-live`、面板语义补齐。
- 边界：不写任何 `prefers-color-scheme`、不做配色/视觉改动。

### D（@dev2，#6 Phase 1 Edge）
- 现有 smoke 基建换 Edge target 冒烟；badge 时序验证；产出 Edge 兼容结论 doc。
- 发现需改代码则报 manager，由文件 owner 改，dev2 不碰 `src/`。

---

## 五、验收标准（@test 逐条对）

### #11（两条正文标准）
1. 深/浅色截图，全面板文字 WCAG AA 4.5:1。
2. 主题跟随 GitLab 自身设置，而非 OS。
3. 全键盘完成「拷贝 → 开面板 → 搜索 → 跳转」。

### #6 Edge Phase 1
1. Edge 真机 smoke 通过。
2. `action.setBadgeText` 时序结论（用 `chrome.action.getBadgeText({})` 断言返回值，不只靠 UI 目视）。

---

## 六、红线约束

1. `src/options.css` 是扩展自有页面，**不跟随 GitLab 主题**；其系统深色分支（`:86` 起）保留，走扩展/OS 偏好，**归 @UI 维护**（options.css 为 UI 独占文件）；dev C 线的 `data-theme` 主题探测**不触碰** options.css。
2. **不新增** `prefers-color-scheme` 到 `badge-css.js`。
3. ~~B2 主题改造（`@media` → `:host([data-theme="dark"])`）等 dev C 合并后串行，不抢跑。~~ **B2（#24）已完成并合入 `origin/main`（PR #26，新增 `:host` 三态合并并保留 `@media` 系统深色回退），此约束已满足。**
4. 提 MR 严禁带入 `dist/`、`node_modules/`、`scripts/`、`screenshots/`、`package-lock.json` 等无关产物。
5. 合并动作须 admin 明确指令，任何人不得自行 merge。

---

## 七、#6 Edge 差异表

见 `docs/edge-smoke-and-badge-css-split.md` 第二节（manifest / API / CSP 三块 + Edge 加载方式 + `setBadgeText` 时序），已按本仓库事实补齐。
