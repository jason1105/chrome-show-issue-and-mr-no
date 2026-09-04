# #11 Release 复测记录（UI B1 冻结基线）

> UI · 2026-09-04 · 基于 PR #15 合入后的 github/main（`1e122f4`）
> 复测分支：`ui/release-retest-b1` @ `8283302`

## 一、复测基线

- github/main = `1e122f4`（Merge pull request #15，已含 BADGE_CSS 拆分）
- B1 a11y 增量 = `8283302`：恰 2 文件（`src/badge-css.js` +9/−5、`src/options.css` +4/−1，8 insertions / 5 deletions）
- 增量精确对应 GitLab B1 冻结基线 `f27cd6a` 的 a11y payload（`2d6231b`→`f27cd6a`，2 文件 +8/−5），无夹带、无 src/ui.js、无 manifest 改动

## 二、验收标准逐条核对

### 1. 全面板文字 WCAG AA 4.5:1 ✅

客观对比度计算（WCAG 相对亮度法），B1 全部提升到位：

| 元素 | 旧值 | 新值 | 对比度 | 判定 |
|---|---|---|---|---|
| filter-pressed / 选中态文字 | `#0969da` | `#0550ae` | 4.56→**6.68** | PASS |
| current-marker 文字 | `#0969da` | `#0550ae` | 4.38→**6.40** | PASS |
| copy-success（hover 底） | `#1f883d` | `#0f6d2e` | 3.89→**5.57** | PASS |
| options `.status`（浅色底） | `#1f883d` | `#0f6d2e` | 4.52→**6.47** | PASS |
| options `.status`（深色模式） | — | `#3fb950` | — | **6.81** | PASS |
| options `.status[error]`（深色） | — | `#f85149` | — | **5.16** | PASS |

> 注：这是相对 **github/main** 的数字（B1 增量全部落在 >6.4 区间），相比修订前凡达不到 4.5 的均已重新落入 AA 区间。

### 2. 主题跟随 GitLab 自身设置（非 OS）⏳

- B1 本波仅做**对比度 + focus-visible 补漏 + options.css 深色补齐**，不含主题跟随逻辑。
- C 线 `data-theme` 主题探测（`badge-css.js:594` `@media` → `:host([data-theme="dark"])`）由 dev 完成，串行在 B1 之后。
- 归属边界：本条属 C 线（@dev），B1 不越权。

### 3. 全键盘走通「拷贝 → 开面板 → 搜索 → 跳转」⏳

- B1 本波只补 `[data-open-items-load-more]:focus-visible`（补漏，非从零）。键盘完整链路属 C 线（@dev）。

### 4. 单元/回归测试 ✅

`npm test`（`NODE_ENV=development`）：**170/170 PASS，0 fail**（github/main 基线 + B1 增量）。

## 三、真机截图（已补齐，浅色主题）

> ✅ **环境已补装，真机「浅色主题」截图已成功产出**（2026-09-04，manager 授权 UI 补环境出图）。

- **环境补装**：下载解压 `chrome-for-testing 152.0.7977.76`（mac-arm64）至 `/tmp/cfT`，安装 `puppeteer-core@25.10.0`，加载**真实未打包扩展**出图。
- **出图基线**：当前工作树 `8283302`（B1 a11y 增量），即 github/main `1e122f4` + B1 增量 —— 与复测基线完全一致。
- **浅色主题保证**：`--force-prefers-color-scheme=light` + 页面级 `emulateMediaFeatures([{prefers-color-scheme:'light'}])`，确保 `@media (prefers-color-scheme: dark)` 分支不生效，徽标/面板呈浅色白底。
- **授权方式**：扩展真实 options 页 `#grant-origin` 点击手势（CDP `Input.dispatchMouseEvent` = 真实用户手势），授权 fixture origin，再经 `syncRegisteredScripts` 注册动态内容脚本（含 persist check + register loop 双断言，吸收 SW 生命周期竞态）。
- **4 张截图**（`screenshots/issue11-release/`，1280×800；原始 2560×1600 高清在 `screenshots/raw/`）：

| 图 | 文件 | 内容 | 主题 |
|---|---|---|---|
| 01 主面板 | `issue11-01-main-panel.png` | 展开面板 Open-only 默认视图，当前项 #8 `Current` 浅蓝高亮 | 浅色 |
| 02 展开面板 | `issue11-02-panel-expanded.png` | 面板「All states」状态筛选视图 | 浅色 |
| 03 滚动徽标 | `issue11-03-badge-scroll.png` | 滚动到底部白色徽标 "Issue #8" 吸顶可见（拖拽手柄 + 复制图标） | 浅色 |
| 04 焦点态 | `issue11-04-focus-visible.png` | 徽标 focus-visible 焦点环（`outline: 2px solid #0969da` 浅蓝） | 浅色 |

- 视觉核对：白底徽标深色文字（`#ffffff` bg / `#1f2937` text，对比度 13.29 远超 AA），面板白底深字，全部浅色主题，符合 B1 规格。
- 留档说明：③「真机截图暂以客观计算替代」的记录已由本图**取代** —— 截图已实际产出，作为验收标准①的可视化证据。



## 四、结论

- **B1 冻结基线的核心复测已通过**：a11y 增量干净（2 文件）、对比度全部达 WCAG AA、回归 170/170 无破坏。
- **真机「浅色主题」截图已补齐**（4 张，见第三节），作为验收标准①的可视化证据，供 @admin 查看样式。
- 待定：主题跟随（C 线）+ 全键盘（C 线）两条标准属 @dev，B1 不承担。
- 建议 @test 基于本条记录 + 实际对比度数据判 AA，独立做验收。

