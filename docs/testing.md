# GitLab Issue/MR Number Pin 测试文档

## 1. 测试目标

验证扩展能够在 `gitlab.com` 及任意 HTTP/HTTPS 自建 GitLab 的 Issue/MR
详情 URL 上显示正确编号，并在滚动和 GitLab 局部导航过程中保持状态正确；同时
确认 Manifest V3、脚本加载顺序、权限和图标均可由 Chromium 正确读取。

## 2. 测试环境

用户目标环境：

| 组件 | 版本 |
| --- | --- |
| macOS 架构 | arm64 |
| Google Chrome（正式版） | 150.0.7871.187 |
| Arc | 1.157.1 (84133) |
| Arc Chromium Engine | 150.0.7871.187 |

2026-07-30 自动化验证环境：

| 组件 | 版本 |
| --- | --- |
| Node.js | 25.8.2 |
| Chrome for Testing | 150.0.7871.124 arm64 |
| ChromeDriver | 150.0.7871.124 arm64 |
| 扩展规范 | Manifest V3 |

正式 Chrome 的版本号已在本机核对。真实浏览器自动化使用相同 Chromium 150
分支的 Chrome for Testing 与配套 ChromeDriver；Arc 和带登录态的真实 GitLab
页面保留为手工验收项。

## 3. 自动化命令

### 3.1 单元与静态测试

```bash
npm test
```

该命令运行：

- `tests/parser.test.js`：URL 解析规则；
- `tests/content.test.js`：标签 DOM、样式和导航生命周期；
- `tests/manifest.test.js`：Manifest、脚本、权限和 PNG 图标。

2026-07-30 实际结果：15 项通过，0 项失败，0 项跳过。

### 3.2 真实 Chromium 测试

```bash
npm run test:browser
```

测试默认查找仓库开发时使用的 Chrome for Testing 150 缓存，也会查找常见的本机
Chrome/Chromium 路径。其他环境可显式指定：

```bash
CHROME_PATH="/path/to/chrome" \
CHROMEDRIVER_PATH="/path/to/chromedriver" \
npm run test:browser
```

Chrome 137 及以上的品牌构建不再允许自动化直接依赖 `--load-extension` 加载
未打包扩展。因此测试先由 ChromeDriver 创建 WebDriver 会话并请求
`webSocketUrl`，再通过 WebDriver BiDi `webExtension.install` 安装仓库目录。
安装完成后使用 Chrome DevTools Protocol 执行 DOM、滚动和真实鼠标断言，结束时
通过 `webExtension.uninstall` 卸载扩展并清理临时 profile 和进程。

2026-07-30 实际结果：1 个端到端场景通过，0 项失败，0 项跳过。

## 4. URL 测试矩阵

| 场景 | 示例 | 预期 |
| --- | --- | --- |
| `gitlab.com` 现代 Issue | `https://gitlab.com/acme/platform/-/issues/123` | `Issue #123` |
| HTTP 自建 GitLab MR | `http://git.tsintergy.com/group/project/-/merge_requests/456` | `MR !456` |
| HTTPS 自建、多层群组 | `https://git.example.test/platform/frontend/web-app/-/issues/7` | `Issue #7` |
| 查询参数与锚点 | `.../-/issues/7?view=parallel#note_99` | `Issue #7` |
| 旧式 Issue | `.../acme/platform/issues/8` | `Issue #8` |
| 旧式 MR | `.../acme/platform/merge_requests/9` | `MR !9` |
| MR 子页面 | `.../-/merge_requests/10/diffs` | `MR !10` |
| Issue 子页面 | `.../-/issues/11/discussion` | `Issue #11` |
| 列表或新建页 | `.../-/issues`、`.../-/issues/new` | 不显示 |
| 编辑页 | `.../-/issues/12/edit` | 不显示 |
| 非法 IID | `0`、`-1`、`12abc` | 不显示 |
| 近似资源名 | `issue`、`merge_request` | 不显示 |
| 非 HTTP 协议或非法 URL | `ftp://...`、`not a URL` | 不显示 |

## 5. 浏览器自动化断言

端到端测试启动仅监听 `127.0.0.1` 的临时 HTTP fixture，并逐项确认：

1. 通过 BiDi 安装扩展后返回合法扩展 ID。
2. Issue URL 首次加载显示 `Issue #123`。
3. 页面中只有一个扩展 host，Shadow DOM 标签已创建。
4. host 的计算样式为 `position: fixed`、`top: 8px` 和
   `pointer-events: none`。
5. 标签中心的 `elementFromPoint` 指向下层按钮，真实鼠标点击能够到达该按钮。
6. 滚动到 `1800px` 后，标签顶部坐标与滚动前一致。
7. SPA 风格切换到 MR 子页面后，唯一标签更新为 `MR !456`。
8. 离开详情页进入 Issue 列表后，标签被移除。
9. 测试结束后扩展被卸载，WebDriver 会话、ChromeDriver、HTTP 服务与临时目录
   均被清理。

## 6. 手工验收

在 Chrome 150 和 Arc 1.157.1 中分别加载仓库根目录，然后执行：

1. 打开 `gitlab.com` 的一个登录态 Issue，确认文案、位置和滚动行为。
2. 打开 `gitlab.com` 的一个登录态 MR，确认显示 `MR !编号`。
3. 在实际自建 GitLab（例如 `http://git.tsintergy.com`）重复 Issue/MR 验证。
4. 从详情页使用 GitLab 页面内链接切换到另一个 Issue/MR，确认编号更新。
5. 打开 Issue/MR 列表页、新建页、编辑页和普通网站，确认标签不显示。
6. 在浅色和深色系统主题下确认标签清晰，并确认顶部导航控件仍可点击。

自动化使用本地 fixture，不访问账号或真实 GitLab 服务，因此不能替代以上对 Arc、
登录态 GitLab 页面、企业实例定制主题及实际页面内导航的手工验收。这些是当前
测试边界，不影响 URL、DOM 生命周期和 Chromium 150 扩展安装机制的自动化覆盖。
