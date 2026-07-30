# GitLab Issue/MR 编号固定标签实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可直接加载到 Chrome 150 和 Arc Chromium 150 的 Manifest V3 扩展，在 `gitlab.com` 及任意 HTTP/HTTPS 自建 GitLab 的 Issue/MR 页面顶部固定显示编号。

**Architecture:** 无构建步骤的内容脚本先通过纯函数解析当前 URL，再将隔离样式的 Shadow DOM 标签挂到页面根节点。内容脚本监听 GitLab/Turbo 导航事件、浏览器导航事件和 DOM 变化，在 URL 改变时更新或移除标签；所有行为仅发生在本地。

**Tech Stack:** Manifest V3、原生 JavaScript、Shadow DOM、Node.js `node:test`、Chrome DevTools Protocol、`glab`。

## Global Constraints

- 同时支持 `https://gitlab.com` 和任意 HTTP/HTTPS 自建 GitLab，包括 `http://git.tsintergy.com`。
- 兼容 Chrome 150.0.7871.187 与 Arc 1.157.1（Chromium 150.0.7871.187）。
- 不引入运行时依赖或构建步骤。
- 不发起网络请求、不持久化数据、不读取 GitLab 正文、评论、账号或认证信息。
- 不申请 `storage`、`tabs`、`cookies`、`identity` 等无关权限。
- Issue 文案为 `Issue #<iid>`，MR 文案为 `MR !<iid>`。
- 保留设计文档、实施计划和独立测试文档，并全部提交到 Git。
- 使用已授权的 `glab` 在 `git.tsintergy.com:8070/lvwei` 下创建内部可见仓库，默认分支为 `main`。

---

### Task 1: URL 解析器

**Files:**
- Create: `package.json`
- Create: `tests/parser.test.js`
- Create: `src/parser.js`

**Interfaces:**
- Produces: `globalThis.GitLabReferenceParser.parseGitLabReference(urlLike)`，返回 `{ kind: "issue" | "merge-request", iid: string } | null`。
- Consumes: 浏览器或 Node 提供的标准 `URL`。

- [ ] **Step 1: 写 URL 解析失败测试**

测试表包含现代/旧式路径、`gitlab.com`、`http://git.tsintergy.com`、HTTPS 自建域名、多层 namespace、查询参数、锚点和合法子页面；负例包含列表、新建、编辑、零/负数/非数字编号、FTP 和近似资源名。测试直接 `require('../src/parser.js')` 并断言公开接口。

- [ ] **Step 2: 运行测试并确认因模块缺失而失败**

Run: `node --test tests/parser.test.js`

Expected: FAIL，错误包含 `Cannot find module '../src/parser.js'`。

- [ ] **Step 3: 实现最小 URL 解析器**

解析器使用 UMD 风格同时暴露浏览器全局和 `module.exports`。它只接受 `http:`/`https:`，通过锚定路径规则要求资源前至少存在 namespace 与 project，接受可选的现代 `/-/` 段，要求 IID 为 `[1-9][0-9]*`，并拒绝第一个尾随段为 `edit` 的路径。

- [ ] **Step 4: 运行解析器测试并确认通过**

Run: `node --test tests/parser.test.js`

Expected: 所有 URL 正例与负例 PASS，零失败。

- [ ] **Step 5: 提交解析器**

```bash
git add package.json tests/parser.test.js src/parser.js
git commit -m "feat: parse GitLab issue and merge request URLs"
```

### Task 2: 固定标签与导航生命周期

**Files:**
- Create: `tests/content.test.js`
- Create: `src/content.js`

**Interfaces:**
- Consumes: `globalThis.GitLabReferenceParser.parseGitLabReference(location.href)`。
- Produces: 页面根节点下唯一的 `#gitlab-reference-badge-host`，其开放 Shadow DOM 中包含 `[data-reference-badge]`。
- Produces: `globalThis.GitLabReferenceBadge` 测试接口，包含 `sync()` 与 `destroy()`。

- [ ] **Step 1: 写内容脚本失败测试**

使用最小真实 DOM 测试夹具（Document、Element、ShadowRoot、MutationObserver、事件目标和 RAF）加载生产脚本，验证：Issue/MR 文案、重复同步只保留一个 host、固定定位、`pointer-events: none`、URL 变更后更新、离开详情页后移除、`destroy()` 清理监听和节点。

- [ ] **Step 2: 运行测试并确认因内容脚本缺失而失败**

Run: `node --test tests/content.test.js`

Expected: FAIL，错误包含 `ENOENT` 或 `src/content.js` 不存在。

- [ ] **Step 3: 实现固定标签与同步逻辑**

`src/content.js` 在 IIFE 中读取解析器；`sync()` 匹配时创建 host 和开放 Shadow DOM，不匹配时移除。`:host` 使用 `position: fixed !important`、`top: 8px`、`left: 50%`、最高安全层级和 `pointer-events: none`；内部标签适配浅色/深色主题并使用 `aria-live="polite"`。

- [ ] **Step 4: 实现导航监听和幂等清理**

监听 `popstate`、`hashchange`、`turbo:load`、`turbolinks:load`、`gl:page:load`，并观察根节点 DOM 变化。调度器通过 `requestAnimationFrame` 合并更新，且只有 `location.href` 改变时才从 MutationObserver 发起同步。

- [ ] **Step 5: 运行内容脚本和完整单元测试**

Run: `node --test tests/parser.test.js tests/content.test.js`

Expected: 全部 PASS，零警告、零失败。

- [ ] **Step 6: 提交内容脚本**

```bash
git add tests/content.test.js src/content.js
git commit -m "feat: keep GitLab reference visible while navigating"
```

### Task 3: Manifest、图标与静态校验

**Files:**
- Create: `manifest.json`
- Create: `icons/icon.svg`
- Create: `icons/icon-16.png`
- Create: `icons/icon-32.png`
- Create: `icons/icon-48.png`
- Create: `icons/icon-128.png`
- Create: `scripts/generate-icons.js`
- Create: `tests/manifest.test.js`

**Interfaces:**
- Consumes: 按顺序加载 `src/parser.js`、`src/content.js`。
- Produces: 可由 Chromium “加载已解压的扩展程序”读取的 Manifest V3 根目录。

- [ ] **Step 1: 写 Manifest 失败测试**

校验 `manifest_version === 3`、版本和名称存在、内容脚本覆盖 `http://*/*` 与 `https://*/*`、`run_at === "document_start"`、脚本顺序正确、无无关 `permissions`、所有脚本和 PNG 图标存在且 PNG 签名/尺寸正确。

- [ ] **Step 2: 运行静态测试并确认因 Manifest 缺失而失败**

Run: `node --test tests/manifest.test.js`

Expected: FAIL，错误包含 `manifest.json` 不存在。

- [ ] **Step 3: 创建 Manifest V3 清单**

内容脚本使用 `matches: ["http://*/*", "https://*/*"]`、`run_at: "document_start"`，不声明扩展 API 权限；图标声明 16、32、48、128 四种尺寸。

- [ ] **Step 4: 创建图标源文件和无依赖 PNG 生成器**

图标为高对比度 GitLab 风格编号标记，生成器只使用 Node 标准库输出四个有效 RGBA PNG；运行 `node scripts/generate-icons.js` 生成清单引用的图标。

- [ ] **Step 5: 运行完整静态与单元测试**

Run: `npm test`

Expected: parser、content、manifest 测试全部 PASS。

- [ ] **Step 6: 提交可加载扩展**

```bash
git add manifest.json icons scripts/generate-icons.js tests/manifest.test.js package.json
git commit -m "feat: package the Chromium extension"
```

### Task 4: 真实 Chromium 验证与测试文档

**Files:**
- Create: `tests/browser.test.js`
- Create: `docs/testing.md`
- Create: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: 本机 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` 或 `CHROME_PATH`。
- Produces: `npm run test:browser`，通过 Chrome DevTools Protocol 启动真实 Chromium、加载当前扩展并验证 DOM 行为。

- [ ] **Step 1: 写真实浏览器测试驱动程序**

测试启动本地 HTTP fixture 和临时 Chrome profile，以 `--disable-extensions-except`、`--load-extension`、`--headless=new` 加载扩展。通过 CDP 验证初始 `Issue #123`、host 唯一、滚动后顶部坐标不变、固定定位、鼠标事件穿透、地址变成 MR 后显示 `MR !456`、离开详情页后节点消失。

- [ ] **Step 2: 运行真实浏览器测试并修复生产行为而非放宽断言**

Run: `npm run test:browser`

Expected: Chrome 150 启动成功，所有运行时断言 PASS；若平台禁止 headless 扩展，则保留同一断言并切换到可见临时窗口执行。

- [ ] **Step 3: 编写 README**

README 说明 Chrome 和 Arc 的“加载已解压的扩展程序”步骤、支持的 GitLab 路径、`gitlab.com` 与自建域名兼容性、所有网站权限原因、无网络/存储行为、测试命令和常见更新方式。

- [ ] **Step 4: 编写独立测试文档**

`docs/testing.md` 记录测试范围、环境版本、自动化命令、URL 用例矩阵、真实浏览器场景、实际执行结果、手工验收步骤与仍需用户在登录态 GitLab 页面确认的边界。

- [ ] **Step 5: 执行完整验证**

Run: `npm test && npm run test:browser && git diff --check`

Expected: 全部测试 PASS，浏览器场景 PASS，无空白错误。

- [ ] **Step 6: 提交文档和浏览器验证**

```bash
git add README.md docs/testing.md tests/browser.test.js package.json
git commit -m "test: verify extension in Chromium"
```

### Task 5: 内部 GitLab 仓库与最终审计

**Files:**
- Preserve: `docs/superpowers/specs/2026-07-29-gitlab-reference-badge-design.md`
- Preserve: `docs/superpowers/plans/2026-07-30-gitlab-reference-badge-implementation.md`
- Preserve: `docs/testing.md`

**Interfaces:**
- Consumes: 已授权主机 `git.tsintergy.com:8070` 的 `glab` 登录。
- Produces: 内部可见项目 `lvwei/chrome-show-issue-and-mr-no` 和指向它的 `origin`。

- [ ] **Step 1: 自审当前仓库**

运行 `git status --short --branch`、`git log --oneline --decorate`、`find`、`npm test`、`npm run test:browser`，逐项核对原始目标、设计完成标准和用户追加的仓库/文档要求。

- [ ] **Step 2: 创建内部项目**

```bash
GITLAB_HOST=git.tsintergy.com:8070 glab repo create lvwei/chrome-show-issue-and-mr-no \
  --internal \
  --defaultBranch main \
  --description "Keep the current GitLab Issue or MR number visible while scrolling" \
  --skipGitInit
```

- [ ] **Step 3: 配置远端并推送**

将本地分支重命名为 `main`，确认 `origin` 指向新项目，再执行 `git push -u origin main`。不得覆盖已存在的非空远端；若项目已存在，先用 `glab repo view` 核验 namespace、可见性和默认分支后复用。

- [ ] **Step 4: 远端验收**

使用 `glab repo view lvwei/chrome-show-issue-and-mr-no` 和 `glab api` 核验 namespace 为 `lvwei`、visibility 为 `internal`、default_branch 为 `main`；确认远端树包含设计文档、实施计划、测试文档、扩展代码和测试。

- [ ] **Step 5: 最终状态检查**

Run: `git status --short --branch && git log -1 --oneline && git remote -v`

Expected: 本地 `main` 跟踪 `origin/main`，工作区干净，远端 URL 为内部项目。
