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

## 三、环境说明（真机截图降级）

> ⚠️ **真机截图因环境缺失，暂以客观计算替代；环境就绪后补出图。**

- 本机 `chrome-for-testing`/`chromedriver`/`playwright`/`selenium` 全部未装；Google GCS 存储 `/chrome-for-testing-public/` 需带版本路径方可下载；补装整套驱动成本高、稳定性差。
- 颜色可达 WCAG AA 4.5:1 属**客观可算**指标（相对亮度法），不依赖目测截图，故本轮复测采信「客观计算 + 单元测试」作为证据链闭环。
- 已存 `screenshots/raw/*.png` 是**旧版深色主题**快照，不代表 PR #15 现浅色主题，已标记过时，不作证据。
- **降级裁定**：(1) 补装驱动后出「浅色主题」真机截图，列为 #11 Release 终验的**可选补强项**，不占门禁；(2) 本轮 B1 冻结基线复测以客观计算 + 170/170 测试为准，正常收口；(3) **是否补环境出图由 admin 决定，不作为本次放行的硬门槛。**


## 四、结论

- **B1 冻结基线的核心复测已通过**：a11y 增量干净（2 文件）、对比度全部达 WCAG AA、回归 170/170 无破坏。
- 待定：①是否需要 UI 补环境出「浅色主题」真机截图作为可视化证据；②主题跟随（C 线）+ 全键盘（C 线）两条标准属 @dev，B1 不承担。
- 建议 @test 基于本条记录 + 实际对比度数据判 AA，独立做验收。
