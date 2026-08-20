# Acceptance Test #14: Dynamic Content Script Persistence Across Restart

## 概述

验收测试 #14 验证动态注册的 content scripts 在浏览器重启后仍然存在（通过 `persistAcrossSessions: true`）。

## Chrome 150.x 权限授权问题

**已知问题**：ChromeDriver 150.0.7871.124 在 macOS 上不再自动接受扩展的 `chrome.permissions.request()` 原生权限气泡。

**解决方案**：测试脚本会在第一次 session 启动后自动打开 options 页面并尝试授权。如果看到浏览器窗口中出现权限气泡，**请手动点击 "Allow" / "允许"**。

## 运行验收测试

```bash
cd .acc1-main
node scripts/acceptance-restart.mjs
```

**预期流程**：
1. 脚本启动 ChromeDriver + Chrome（第一次 session）
2. 加载扩展，导航到 options 页面
3. **手动操作**：如果出现权限气泡，点击 "Allow"
4. 脚本验证注册状态
5. 优雅关闭浏览器
6. 重启浏览器（第二次 session，使用相同 profile）
7. **验收核心**：验证 content scripts 仍然注册且 `persistAcrossSessions: true`

## 验收标准

### Session 1（授权后，重启前）
- ✅ `getRegisteredContentScripts()` 返回 2 个脚本：
  - `gitlab-reference-navigation-hook`（world: MAIN, persistAcrossSessions: true）
  - `gitlab-reference-content-scripts`（persistAcrossSessions: true）
- ✅ 徽章在 issue 页面正常显示

### Session 2（重启后）
- ✅ `getRegisteredContentScripts()` 仍返回 2 个脚本
- ✅ `persistAcrossSessions: true` 保持
- ✅ matches 正确（`${origin}/*`）
- ✅ world 正确（hook 为 MAIN）
- ✅ js 文件顺序正确
- ✅ 徽章仍然工作

## 故障排除

### 权限气泡未出现
- 脚本会等待最多 10 秒，并截图保存到 `/tmp/acc1-options-*.png`
- 如果超时，验收失败，查看截图定位问题

### 重启后注册丢失
- 检查 `permissions.js` 中 `PERSISTENT_REGISTRATION_ENABLED` 是否为 `true`
- 检查 `background.js` 中 `chrome.runtime.onStartup` 是否重新注册

### ChromeDriver 版本不匹配
- 脚本默认使用 `~/Library/Caches/chrome-for-testing/150.0.7871.124/`
- 可通过环境变量覆盖：
  ```bash
  CHROME_PATH=/path/to/chrome CHROMEDRIVER_PATH=/path/to/chromedriver node scripts/acceptance-restart.mjs
  ```
