# UI 视觉规范：#11 P0-c — `:focus-visible` 焦点环体系化 + 空状态 / Toast

> UI 交付 · 供 P0-a(dev) / P0-b(dev2) 落地引用 · 2026-09-06
> 本文只产出**视觉规范与实现建议**，不落地任何 `src/` 改动（遵守 P0-c 只动 `docs/` 约束）。
> 全部对比度用 WCAG 相对亮度法**独立复算**（校验函数对 `#000/#fff`=21.00、`#767676/#fff`=4.54、`#777777/#fff`=4.48，与标准值一致），非估算、非自述。
> 源码基准：`github/main` = `34d0e70`；`src/badge-css.js` 869 行。

---

## 0. 任务与边界

- **目标**：为 #11 的「焦点可见性 / 空状态 / 复制成功 toast」给出统一的尺寸、配色、动效规范，**对比度必须过 WCAG AA**（文本 4.5:1，非文本 3:1）。
- **P0-c 边界**：只出规范 + 实现建议；落点文件归属见第 6 节，避免与 dev/dev2 撞文件。
- **范围外**：键盘焦点的**行为**（开面板聚焦、focus trap、Esc 归还焦点）属 P0-b；本规范只管它们的**视觉呈现**。

---

## 1. 设计令牌（Design Tokens）

焦点环 & 空状态/toast 用色，统一为可复用令牌。表格中 `实测对比度` 均为本文复算值。

| 令牌 | Light | Dark | 用途 | 实测对比度 |
|---|---|---|---|---|
| `--pin-focus-ring` | `#0969da` | **`#58a6ff`** | 焦点环描边色 | light: 5.19 / dark: 5.93(面板底)·6.32(搜索底) |
| `--pin-focus-ring-width` | `2px` | `2px` | 焦点环描边宽度 | — |
| `--pin-text-primary` | `#1f2328` | `#f0f6fc` | 面板/空状态主文案 | 15.80 / 13.75 |
| `--pin-text-muted` | `#57606a` | `#b7bdc8` | 面板/空状态辅助文案 | 6.39 / 7.93 |
| `--pin-surface-pop` | `#24292f` | `#1f2227` | toast/tooltip 深色面 | 白字 14.65 / 15.95 |
| `--pin-success-on-pop` | `#7ee787` | `#7ee787` | toast 成功勾选图标 | 9.54 / 10.38 |

> 说明：`--pin-text-muted` 在**暗色**下**不可**用 `#57606a`（实测 2.34，不过 4.5:1）；暗色一律用 `#b7bdc8`（7.93）。

---

## 2. 焦点环体系（P0）

### 2.1 现状（已核实，非推测）

`src/badge-css.js` 内共 8 处 `:focus-visible` 规则，全部硬编码 `#0969da` + `outline-offset: -2px`（内缩 ring）：

```
:73   [data-drag-handle]:focus-visible
:138  [data-reference-trigger]:focus-visible
:265  [data-refresh-open-items]:focus-visible, [data-open-item]:focus-visible, [data-open-items-load-more]:focus-visible
:354  [data-open-items-filter]:focus-visible
:406  [data-open-options]:focus-visible
:534  [data-copy-reference]:focus-visible
```

搜索框 `[data-open-items-search]:focus`（`:310` 起）用「边框变色 + 内衬 `box-shadow` + `outline:none`」，跟随 GitHub 输入框惯例。页面级 `src/options.css:80` 用**外扩** ring（`outline-offset: 2px`）。

### 2.2 关键缺陷（重点）

**暗色下当前焦点环不合格。** `#0969da` 在暗色面板底 `#24272d` 上实测 **2.883:1**，低于 WCAG 非文本 **3:1**；在搜索底 `#1f2227` = 3.073 仅勉强过。也就是说暗色用户用 ↑/↓ 或 Tab 浏览行时，焦点环几乎看不清。

### 2.3 建议（修正）

- **暗色焦点环色改为 `#58a6ff`**：实测在 `#24272d` = 5.93:1、在 `#1f2227` = 6.32:1，均远超 3:1。`#79c0ff` 亦可（7.70 / 8.20），但 `#58a6ff` 是 GitHub 暗色标准 accent，与产品语境更贴合。**推荐 `#58a6ff`**。
- **Light 不变**：`#0969da`（5.19:1，达标）。
- 宽度统一 `2px`；偏移约定：**面板内控件内缩 `-2px`**（避免被面板边缘裁切）、**页面级控件外扩 `2px`**。

### 2.4 建议实现（供 P0-a 落 `badge-css.js`）

```css
/* 令牌 */
:host {
  --pin-focus-ring: #0969da;
  --pin-focus-ring-width: 2px;
}
:host([data-theme="dark"]) {
  --pin-focus-ring: #58a6ff;
}

/* 面板内控件：内缩 ring */
[data-drag-handle]:focus-visible,
[data-reference-trigger]:focus-visible,
[data-refresh-open-items]:focus-visible,
[data-open-item]:focus-visible,
[data-open-items-load-more]:focus-visible,
[data-open-items-filter]:focus-visible,
[data-open-options]:focus-visible,
[data-copy-reference]:focus-visible {
  outline: var(--pin-focus-ring-width) solid var(--pin-focus-ring);
  outline-offset: -2px;
}

/* 搜索输入框：保持 GitHub 输入框惯例 */
[data-open-items-search]:focus {
  border-color: var(--pin-focus-ring);
  box-shadow: 0 0 0 1px var(--pin-focus-ring);
  outline: none;
}
```

页面级 `src/options.css:80` 同步换成同一色值（外扩 ring）：

```css
button:focus-visible, select:focus-visible, input:focus-visible {
  outline: 2px solid var(--pin-focus-ring, #0969da);
  outline-offset: 2px;
}
```

> 注意：`options.css` 不在 `BADGE_CSS` 内，独立文件，需单独同步令牌色值。

---

## 3. 空状态（P1 视觉规格）

**现状**：`[data-open-items-empty]` 只有一行 12px 居中静默文字（`#6e7781` / dark `#b7bdc8`），无插图、无动作（`src/badge-css.js:442`，内容由 `content.js:1122-1129` 生成，`role="status"`）。#11 P1 要求「插图 + 一个动作」。

**规格**：

| 项 | 值 |
|---|---|
| 容器 | `min-height:120px`，flex column 居中，`gap:8px`，`padding:24px 16px` |
| 插图（可选） | 48×48 线性图标，`currentColor`，色 `#57606a`(light)/`#8b949e`(dark)，`aria-hidden="true"`（装饰性，不读屏） |
| 主文案 | 14px/20px 500，色 `--pin-text-primary`，文案用 i18n `emptyNoMatchOpen`/`emptyNoMatchAll` |
| 辅助文案（可选） | 12px/18px，色 `--pin-text-muted`，用于区分「无匹配」vs「项目本就无 open」 |
| 动作按钮（仅一个） | 复用面板 filter 造型（高 28px、圆角 6px、描边），如「清空搜索」或「查看全部 open」，必须带 `:focus-visible` ring |

**对比度小结**：主文案 15.80/13.75 ✅、辅助 6.39/7.93 ✅、插图（非文本 ≥3:1）6.39/4.87 ✅、动作文字 4.5:1 ✅。全部过 WCAG AA。

---

## 4. Toast（复制成功，P1 视觉规格）

**现状**：复制成功目前无可见 toast，只有「图标变绿（`data-copy-state="success"`）+ 隐藏 SR 公告（`[data-copy-announcement]`）+ hover/focus tooltip」。**需要新增可视 toast**。

**规格**：

| 项 | 值 |
|---|---|
| 位置 | 锚定在被复制按钮下方，复用 `[data-copy-tooltip]` 定位；`z-index` 高于 tooltip，避免覆盖面板控件 |
| 尺寸 | `padding:7px 11px`，`border-radius:6px`，`max-width:240px`，`box-shadow:0 2px 8px rgba(17,24,39,.25)` |
| 配色 | 深色面 `--pin-surface-pop` + 白字 `#ffffff`（14.65/15.95，历久弥新抗任何页面底），勾选图标 `#7ee787`（9.54/10.38） |
| 内容 | 勾选图标 16×16 + 文案「已复制」/「Copied」，12px/16px 600 |
| 动效 | 入场 `translateY(-2px)→0` + opacity，`150ms ease`；停留 **1800ms** 后淡出 `150ms`；同位置替换避免堆叠 |
| 无障碍 | 视觉 toast 不重复读；SR 用现有 `[data-copy-announcement]` 公告一次，`role="status"` + `aria-live="polite"` |

**与 tooltip 区分**：toast 是「动作成功」的瞬时反馈，tooltip 是「操作提示」；两者同锚点共存时 toast 出现期间 tooltip 不再显示。

---

## 5. 动效 / Reduced Motion

- 焦点环、空状态：**无入场动效**（静态、即时反馈），不新增自动循环/悬浮动画。
- toast：唯一动效（入场位移+淡入、退场淡出）。
- 全局 `@media (prefers-reduced-motion: reduce)`：关闭位移与过渡，仅保留结果（显示即到位，或无过渡淡入淡出）。

---

## 6. 文件归属与交接

| 交付物 | 文件 | 归属 |
|---|---|---|
| 焦点环令牌 + 面板内 `:focus-visible` 规则 | `src/badge-css.js` | P0-a(dev) |
| 焦点环色值同步 | `src/options.css:80` | P0-a(dev) / UI |
| 空状态插图 + 动作按钮 **DOM** | `src/content.js` | P0-b(dev2) 或 UI 后续 |
| toast **DOM** + 定时器 + reduced-motion 分支 | `src/content.js` | P0-b(dev2) 或 UI 后续 |
| 新增 i18n（toast / 空状态辅助文案） | `src/i18n.js` + `_locales/` | 见上 |

> P0-c 本身**不**改上述文件；本文档交付后由 manager 派工落地。

---

## 7. 自测 / 验收对照表

| 元素 | 前景 / 有效背景 | 实测比值 | 判定 |
|---|---|---|---|
| 焦点环(light) | `#0969da` / `#ffffff` | 5.19 | ≥3:1 PASS |
| 焦点环(dark·面板) | `#0969da` 现值 / `#24272d` | **2.88** | **<3:1 FAIL** → 改 `#58a6ff`(5.93) |
| 焦点环(dark·search) | `#0969da` 现值 / `#1f2227` | 3.07 | 勉强，改 `#58a6ff`(6.32) |
| 空状态主文案 | `#1f2328`/`#f0f6fc` / 面板 | 15.80 / 13.75 | 4.5:1 PASS |
| 空状态辅助 | `#57606a`/`#b7bdc8` / 面板 | 6.39 / 7.93 | 4.5:1 PASS |
| toast 文字 | `#ffffff` / `#24292f`/`#1f2227` | 14.65 / 15.95 | 4.5:1 PASS |
| toast 勾选 | `#7ee787` / toast 面 | 9.54 / 10.38 | 3:1 PASS |

**结论**：全表除「暗色焦点环现值」一项不达标（需按 2.3 修正）外，其余全部满足。修正 `#0969da`→`#58a6ff` 后，焦点环、空状态、toast 三项一套规范全部过 WCAG AA。

---

> 待 @manager 评审：指定上述落地归属（尤其新建 toast 与空状态插图 DOM 归 dev2 还是 UI 后续线），并核 P0-a(dev) 令牌化是否能与本规范共享 `--pin-focus-ring`。
