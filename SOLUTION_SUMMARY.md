# 验收①环境阻塞修复方案总结

## 根因
ChromeDriver 150.0.7871.124 在 macOS 上不再自动接受扩展的 `chrome.permissions.request()` 原生权限气泡。

## 解决方案（已实施）
采用**方案 B（简化版）**：修改验收脚本，在授权环节等待最多 30 秒，允许手动点击权限气泡。

## 修改内容
1. **验收脚本** (`.acc1-main/scripts/acceptance-restart.mjs`)：
   - 移除了 Puppeteer 预授权步骤（避免依赖安装问题）
   - 授权环节改为循环等待 30 秒
   - 第一次尝试时自动点击「授权」按钮（CDP mouse event）
   - 如果权限气泡出现，脚本暂停并显示提示，等待手动点击 "Allow"
   - 每秒轮询 `#origin-status`，检测是否显示「已授权 ${origin}」
   - 首次尝试时截图保存到 `/tmp/acc1-options-1.png`

2. **使用说明** (`.acc1-main/ACCEPTANCE_TEST_README.md`)：
   - 记录了 Chrome 150.x 权限问题
   - 说明需要手动点击权限气泡
   - 提供故障排除指南

## 验收流程（test 执行）
```bash
cd .acc1-main
node scripts/acceptance-restart.mjs
```

**预期交互**：
1. 脚本启动后会显示警告：
   ```
   ⚠️  Chrome 150.x does NOT auto-accept permission bubbles.
   ⚠️  If you see a permission bubble in the browser window, click "Allow" manually.
   ```
2. 脚本自动打开 options 页面并点击「授权」按钮
3. **如果浏览器窗口出现权限气泡，手动点击 "Allow"**
4. 脚本检测到授权成功后继续执行
5. 其余验收流程自动完成

## 判定口径（不变）
- Session 1（授权后）：2 个脚本注册，`persistAcrossSessions: true`
- Session 2（重启后）：2 个脚本仍存在，world/matches/js 正确

## 回退到预授权方案 A 的前提
如果未来需要完全无人值守，需满足：
1. 成功安装 `puppeteer-core`（当前 npm 安装异常）
2. 或降级到 Chrome < 150（自动接受权限）
3. 或使用 `scripts/prepare-test-profile.js` 手动预授权一次，打包 profile tarball

当前方案 B 是最务实的选择：一次手动点击，换取验收流程的可执行性。

---

@test 修复完成。验收脚本已更新到 `.acc1-main/scripts/acceptance-restart.mjs`，现在可以复跑验收①。运行时如果看到浏览器窗口中出现权限气泡，请手动点击 "Allow"。判定口径不变。
