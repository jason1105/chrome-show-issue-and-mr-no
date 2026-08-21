# GitLab Issue/MR Number Pin — Code Review 规则

## 1. 审查范围

每次 MR 审查需覆盖以下维度：

- 代码正确性、可维护性
- 安全性（Manifest V3、权限边界、数据隔离）
- 测试覆盖（单元测试 + 浏览器集成测试）
- Manifest V3 规范合规
- 浏览器兼容性（Chrome 150 / Arc 1.157.1，Chromium 150）
- 配置迁移与存储保护
- 无障碍（a11y）
- 性能（DOM 操作、Shadow DOM 隔离、网络请求）

## 2. 代码规范

### 2.1 语言与风格

- 纯原生 JavaScript，无构建步骤、无运行时依赖
- IIFE 模块模式（`(function exposeXxx(root, factory) { ... })`）
- 严格模式 `'use strict'`
- 双引号 `"` 用于字符串
- 2 空格缩进
- 语义化常量全大写 + 下划线（`FEEDBACK_DURATION_MS`）
- 函数名使用 `camelCase`，构造函数/工厂用 `createXxx`

### 2.2 文件组织

```
src/parser.js       — URL 解析器，导出 parseGitLabReference
src/config.js       — 统一配置层，导出 createConfigStore 等
src/content.js      — 核心内容脚本，渲染标签、复制、拖拽、搜索、导航面板
src/options.js      — 设置页控制器
src/options.html    — 设置页 UI
src/options.css     — 设置页样式
manifest.json       — Manifest V3 声明
tests/              — 测试文件，与 src/ 一一对应
docs/               — 设计文档、实施计划、测试文档、Review 规则
```

### 2.3 命名约定

- 事件监听器名：`onXxx` (如 `onConfigChanged`)
- 私有状态变量：模块级 `let`，不暴露到全局作用域
- 清除/销毁方法：`dispose()`、`destroy()`
- ID 常量：`HOST_ID`、`PANEL_ID`

## 3. 安全性

### 3.1 权限最小化

- 只请求 `storage` 权限，禁止新增其他权限
- 不读取 token、cookie 或认证信息
- 不发起跨域请求 — 所有 GitLab API 请求使用同源 `fetch` + 当前登录态 session cookie

### 3.2 数据保护

- `PROTECTED_CONFIG` 不可被外部输入覆盖：`allowRemoteConfig: false`、`storeSensitiveData: false`
- 配置持久化到 `chrome.storage.sync`（旧版 `storage.local` 数据首次加载时自动迁移），不存储敏感数据
- 禁止 `innerHTML` 直接拼接用户/API 数据；使用 `textContent` 或 `createElement` + 白名单属性

### 3.3 URL 解析安全

- `parseGitLabReference` 必须校验：
  - 协议必须是 `http:` 或 `https:`
  - IID 必须是正整数（`/^[1-9][0-9]*$/`）
  - 拒绝 `edit` 子页面
  - `decodeURIComponent` 异常必须捕获并返回 `null`

## 4. Manifest V3 合规

- `manifest_version` 必须为 `3`
- `content_scripts.run_at` 必须为 `document_start`（确保脚本在页面加载前注入）
- 脚本加载顺序：`parser.js` → `config.js` → `content.js`
- 不包含任何 `manifest.json` 冗余字段（如 `background`、`action`、`host_permissions`）

## 5. 配置层审查

### 5.1 迁移

- 配置版本号递增时，`CONFIG_MIGRATIONS` 必须包含从 `version` 到 `CONFIG_VERSION` 的完整迁移链
- 迁移函数必须幂等 — 失败时回退到 `getDefaultConfig()`
- 旧版键（如 `LEGACY_POSITION_STORAGE_KEY`）迁移后必须清理

### 5.2 校验

- 所有用户偏好必须经过 `normalizePreference` 校验（枚举值、整数范围、布尔类型）
- 非法值静默回退到默认值，不抛异常
- `normalizePosition` 必须校验 `edge` 枚举和 `ratio ∈ [0, 1]`

### 5.3 存储

- 保存失败时保留当前内存配置，不覆盖
- 浏览器存储写入失败时显示错误反馈（设置页）
- 跨标签页同步通过 `chrome.storage.onChanged` + `handleStorageChanged`

## 6. 内容脚本审查

### 6.1 生命周期

- `destroy()` 必须清理所有资源：observer、定时器、事件监听器、DOM 节点
- SPA 导航（`popstate`、`hashchange`、`turbo:load` 等）必须正确销毁旧实例并重建
- 同项目缓存复用，跨项目缓存隔离

### 6.2 异步安全

- 使用 `copyGeneration` 防止旧异步结果污染当前状态
- 使用 `positionGeneration` 防止旧位置保存覆盖新位置
- 所有 `fetch` 请求必须带 `AbortController` 或通过 generation 检查

### 6.3 DOM 操作

- 使用 Shadow DOM 隔离样式，避免污染宿主页面
- 禁止直接操作宿主页面的 DOM 树
- 控件位置计算必须在 `requestAnimationFrame` 中进行

### 6.4 交互

- 拖拽：4px 阈值、pointer capture、取消清理
- 边缘吸附：顶部/左侧/右侧，保持 `VIEWPORT_MARGIN` 间距
- 窗口缩放后保持可见
- 双击复位到默认位置
- 键盘微调（上下左右箭头 + 步长）

### 6.5 无障碍

- 复制按钮：原生 `<button>` 语义 + `aria-label` + `aria-live` 播报
- 拖拽手柄：`aria-grabbed` 状态
- 导航面板：键盘聚焦、Enter/Space 打开、Escape 关闭
- 触摸支持：`touchDrag` 配置项

## 7. 测试要求

### 7.1 单元测试

- 修改任何 `src/*.js` 必须同步更新对应的 `tests/*.test.js`
- 新增 API 必须覆盖：正常路径、边界值、异常输入、降级路径
- 当前基线：96 项通过，0 失败 — 不允许引入回归

### 7.2 浏览器集成测试

- 涉及 DOM 操作、用户交互、真实浏览器 API 的改动，必须补充 `tests/browser.test.js`
- 使用 `npm run test:browser` 验证

### 7.3 测试检查清单

- [ ] `npm test` 全部通过
- [ ] 新增代码有对应测试用例
- [ ] 未修改的测试用例仍然通过
- [ ] 涉及真实浏览器环境的改动已补充 `browser.test.js`

## 8. 性能

- 避免在滚动事件中执行重计算 — 使用 `requestAnimationFrame` 节流
- 导航面板：悬停 150ms 后打开，离开 250ms 后关闭（防抖）
- API 请求：缓存默认 60 秒，可配置（5–300 秒）
- 位置保存：防抖 200ms
- 搜索状态保存：防抖 200ms

## 9. GitLab API 集成

- 使用编码后的项目路径请求同源 API（`/api/v4/projects/${encodeURIComponent(projectPath)}/issues`）
- 支持 `X-Next-Page` 分页标头
- 并行加载 Issue/MR（`loadingMode: 'parallel'`）或顺序加载（`'sequential'`）
- API 失败时保留旧缓存数据，不回退到空列表

## 10. 审查流程（基于 GitLab + glab CLI）

### 10.1 提交前自查

提交 MR 前，开发者需确认：

- [ ] `npm test` 全部通过
- [ ] 代码符合第 2 节规范
- [ ] 安全性检查通过（第 3 节）
- [ ] Manifest V3 无改动，或改动合规（第 4 节）
- [ ] 配置迁移无遗漏（第 5 节，如有配置变更）
- [ ] 生命周期管理正确（第 6.1 节）
- [ ] 无障碍标签完整（第 6.5 节）

### 10.2 Reviewer 检查清单

- [ ] 代码逻辑正确，无边界情况遗漏
- [ ] 错误处理完善：网络失败、存储失败、DOM 不可用、API 返回异常数据
- [ ] 异步安全：generation 检查、AbortController、竞态条件
- [ ] 测试覆盖充分，新增/修改路径有测试用例
- [ ] 配置迁移无遗漏
- [ ] 权限无新增
- [ ] Shadow DOM 隔离无泄漏
- [ ] 浏览器兼容性无退化（Chrome 150 / Arc 1.157.1）

### 10.3 审查操作流程

所有审查操作通过 `glab` CLI 完成，无需在浏览器中打开 GitLab。

#### Step 1: 获取 MR 信息

```bash
# 查看 MR 详情（标题、描述、分支、状态）
glab mr view <MR_ID|分支名>

# 查看 MR 的变更文件列表和统计
glab mr diff <MR_ID> --name-only
glab mr diff <MR_ID> --stat

# 查看完整 diff
glab mr diff <MR_ID>
```

#### Step 2: 检查代码

```bash
# 在本地 checkout MR 分支，便于完整审查
glab mr checkout <MR_ID>

# 运行测试
npm test

# 检查常见问题
git diff main...HEAD --stat
git diff main...HEAD | grep -n "console\.log\|TODO\|FIXME\|debugger"
```

#### Step 3: 落评论（核心）

使用 `glab mr note create` 在 MR 上添加评论，支持三种评论类型：

**a) 普通评论（MR 级别讨论）**

```bash
# 直接指定消息
glab mr note create <MR_ID> -m "评论内容"

# 从 stdin 读取（适合长评论）
echo "评论内容" | glab mr note create <MR_ID>

# 打开编辑器编写
glab mr note create <MR_ID>
```

**b) 行内评论（diff 行级评论）**

```bash
# 对新增代码的第 42 行评论
glab mr note create <MR_ID> \
  --file src/content.js \
  --line 42 \
  -m "这里需要添加 AbortController 来防止竞态条件"

# 对多行范围评论（第 10 到 15 行）
glab mr note create <MR_ID> \
  --file src/config.js \
  --line 10:15 \
  -m "建议提取为独立函数"

# 对被删除的行评论（old side）
glab mr note create <MR_ID> \
  --file src/parser.js \
  --old-line 7 \
  -m "为什么删除了这个校验？需要确认安全性"

# 对文件级别评论（不指定行号）
glab mr note create <MR_ID> \
  --file manifest.json \
  -m "Manifest 的改动需要特别关注，确认权限无新增"
```

**c) 回复已有讨论**

```bash
# 回复一个已有的讨论线程
glab mr note create <MR_ID> \
  --reply <discussion-id> \
  -m "同意，已按要求修改"
```

#### Step 4: 提交审查结论

```bash
# 批准 MR
glab mr approve <MR_ID> -m "审查通过，代码质量良好"

# 仅评论（不批准也不拒绝）
# 在 MR 上添加总结评论即可
glab mr note create <MR_ID> -m "## Review Summary\n\n..."
```

#### Step 5: 清理

```bash
# 切回主分支
git checkout main
```

### 10.4 评论格式规范

每条审查评论应遵循以下格式，便于开发者快速定位和处理：

```
🔴 Critical | ⚠️ Warning | 💡 Suggestion | ✅ Good

**文件:行号** — 问题描述

建议：具体的修改建议

理由：为什么需要改（引用规范章节）
```

示例：

```bash
# Critical 问题
glab mr note create 5 --file src/content.js --line 245 \
  -m "🔴 **Critical:** 缺少 AbortController，fetch 未取消可能导致旧请求结果覆盖当前状态。

**建议：** 添加 AbortController，在 destroy() 中调用 abort()。

**理由：** 违反 §6.2 异步安全规则，SPA 导航时可能产生竞态条件。"

# Warning 问题
glab mr note create 5 --file src/config.js --line 120 \
  -m "⚠️ **Warning:** 配置迁移缺少版本 v2→v3。

**建议：** 在 CONFIG_MIGRATIONS 中添加 `[2, migrateV2ToV3]`。

**理由：** §5.1 要求从 version 到 CONFIG_VERSION 的完整迁移链。"

# Suggestion
glab mr note create 5 --file src/content.js --line 890 \
  -m "💡 **Suggestion:** 可提取 createPanelElement 为独立函数，减少嵌套层级。

当前嵌套 4 层，提取后更易测试和维护。"
```

### 10.5 合并条件

- 所有 CI 检查通过
- 至少一名 Reviewer 批准
- 无未解决的讨论线程（Critical 和 Warning 级别）
- 分支可自动合并（`can_be_merged`）

### 10.6 完成声明与可核验产物

所有「已完成」的声明必须附带**可核验产物**，确保工作成果可追溯、可复现。

#### 10.6.1 产物类型

根据工作类型，需提供以下对应产物：

| 工作类型 | 必需产物 | 示例 |
|---------|---------|------|
| **代码提交** | commit SHA | `git cat-file -p f8c107e` 可验证 |
| **测试运行** | 完整测试输出 | `npm test` 的 stdout/stderr 全文 |
| **Issue/MR 操作** | GitLab Note ID | `#note_746866`（可通过 `glab api` 查证）|
| **文件生成** | 文件路径 + 校验和 | `tests/fixtures/pre-granted-profile.tar.gz` + `shasum -a 256` |
| **配置/脚本修改** | 修改前后 diff | `git diff` 输出或完整文件内容 |

#### 10.6.2 纪律要求

**禁止空口声明**：

❌ 错误示例：
- "测试已通过"（无输出）
- "已提交代码"（无 SHA）
- "已在 MR 上评论"（无 Note ID）

✅ 正确示例：
- "测试已通过，输出见 `#note_746866`，120/120 全绿"
- "已提交 `f8c107e`，可验证：`git cat-file -p f8c107e`"
- "已在 MR !9 留痕 `#note_746866`，链接：http://git.tsintergy.com:8070/..."

#### 10.6.3 核验流程

Reviewer/Manager 必须核验产物：

```bash
# 验证 commit SHA
git cat-file -p <SHA>

# 验证 GitLab Note
glab api "/projects/7533/merge_requests/9/notes" | jq '.[] | select(.id == 746866)'

# 验证测试输出（从贴出的 Note/评论中获取）
# 检查：测试用例数、通过率、关键断言、运行时间

# 验证文件完整性
shasum -a 256 tests/fixtures/pre-granted-profile.tar.gz
tar -tzf tests/fixtures/pre-granted-profile.tar.gz | wc -l
```

**拒绝合并条件**：
- 声明完成但无产物
- 产物无法核验（SHA 不存在、Note ID 404、文件缺失）
- 产物与声明不符（测试输出显示失败但声称通过）

### 10.7 首次授权手工验收要求（Issue #8 专项）

Issue #8（可选权限收窄）采用**方案 1**：每个 MR 需进行一次人工授权验收，确保「首次安装 → 授权」流程正常。

#### 10.7.1 验收范围

- **触发时机**：Issue #8 相关 MR 合并前
- **验收目标**：验证扩展首次安装后，用户可通过选项页成功授予 `http://127.0.0.1:8080/*` 和 `http://git.tsintergy.com:8070/*` 权限，且授权后功能正常
- **预期耗时**：约 30 秒

#### 10.7.2 验收步骤

1. **清理环境**：
   ```bash
   # 确保无残留 Chrome 进程
   pkill -9 -f chrome-for-testing
   
   # 清理扩展授权状态（可选，确保干净环境）
   rm -rf /tmp/chrome-test-profile-*
   ```

2. **安装扩展**（首次安装场景）：
   - 方式 A：通过 `chrome://extensions` 手动加载 `src/` 目录
   - 方式 B：运行 `npm run test:browser`，在测试启动后、授权前暂停

3. **打开选项页**：
   - 点击扩展图标 → "选项" / "Options"
   - 或直接访问 `chrome-extension://<扩展ID>/src/options.html`

4. **授予权限**：
   - 在选项页的「Origin」输入框中输入 `http://127.0.0.1:8080`
   - 点击「授权实例」按钮
   - 浏览器弹出原生权限气泡（"Allow this site to read and change site information?"）
   - **人工点击「Allow」**
   - 确认选项页显示 `已授权 http://127.0.0.1:8080` 状态文本（options.js:170）
   - 重复上述步骤授权 `http://git.tsintergy.com:8070`

5. **验证功能**：
   - 打开 `http://127.0.0.1:8080`（或任意 GitLab Issue/MR 页面）
   - 确认页面上 Issue/MR 编号正常显示（扩展 content scripts 已注入）
   - 打开 DevTools Console，确认无权限相关错误

6. **记录产物**：
   - 截图选项页授权成功状态（必需）
   - 截图目标页面功能正常（必需）
   - 贴出验收时的 commit SHA（必需）

#### 10.7.3 验收纪律

- **每个 Issue #8 相关 MR 合并前必须完成一次首次授权验收**
- 验收产物（截图 + SHA）必须在 MR 评论区留痕（参考 §10.6）
- 若验收失败（授权气泡未弹出、授权后功能异常），MR 不得合并，需修复后重新验收

#### 10.7.4 技术边界说明

- **自动化不覆盖首次授权路径**：Chrome 原生权限气泡无法通过 CDP、Playwright、WebDriver 等自动化工具可靠触发点击（安全限制）
- **预置权限方案（方案 2）已放弃**：Chrome `Secure Preferences` HMAC 完整性校验机制阻断运行时预置权限注入，且扩展 ID 由绝对路径派生、不可移植
- **现状可接受**：人工验收耗时约 30 秒，成本低于绕行技术障碍的投入

## 11. 附录：常用命令

```bash
# 运行单元测试
npm test

# 运行浏览器集成测试
npm run test:browser

# 指定浏览器路径
CHROME_PATH="/path/to/chrome" CHROMEDRIVER_PATH="/path/to/chromedriver" npm run test:browser

# === glab 操作 ===

# 查看 Issue/MR 列表
glab issue list
glab mr list

# 查看 MR 详情
glab mr view <MR_ID>

# 查看 MR diff
glab mr diff <MR_ID>
glab mr diff <MR_ID> --name-only
glab mr diff <MR_ID> --stat

# 在 MR 上添加评论
glab mr note create <MR_ID> -m "评论内容"
glab mr note create <MR_ID> --file <path> --line <N> -m "行内评论"
glab mr note create <MR_ID> --file <path> --old-line <N> -m "对删除行的评论"

# 批准 MR
glab mr approve <MR_ID> -m "审查通过"

# 调用 GitLab API
glab api "/projects/:fullpath/issues?state=opened"
glab api "/projects/:fullpath/merge_requests?state=opened"
```