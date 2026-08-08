# GitLab Issue/MR Number Pin 测试文档

## 1. 测试目标

验证扩展能够在 `gitlab.com` 及任意 HTTP/HTTPS 自建 GitLab 的 Issue/MR
详情 URL 上显示正确编号，快速复制 `#编号` 或 `!编号`，并通过当前项目的 Open
Issue/MR 列表快速跳转。还需确认控件拖动、边缘吸附、位置持久化、窗口缩放、面板
展开方向、输入方式、接口失败、缓存刷新和 GitLab 局部导航过程中的状态正确，同时
确认 Manifest V3、脚本加载顺序、权限和图标均可由 Chromium 正确读取。

## 2. 测试环境

用户目标环境：

| 组件 | 版本 |
| --- | --- |
| macOS 架构 | arm64 |
| Google Chrome（正式版） | 150.0.7871.187 |
| Arc | 1.157.1 (84133) |
| Arc Chromium Engine | 150.0.7871.187 |

2026-08-06 自动化验证环境：

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
- `tests/config.test.js`：配置默认值、枚举和范围校验、站点 profile、迁移、保护约束及存储失败；
- `tests/content.test.js`：标签 DOM、复制反馈、降级路径、配置驱动行为和导航生命周期；
- `tests/manifest.test.js`：Manifest、脚本、权限、设置页和 PNG 图标；
- `tests/options.test.js`：设置页加载、保存、恢复默认值和保存失败反馈。

2026-08-08 实际结果：70 项通过，0 项失败，0 项跳过。

配置层单元测试覆盖以下行为：

- 缺省配置、非法枚举值、整数范围和布尔值校验；
- 无版本配置通过显式迁移管线升级到当前 schema 并回写存储；
- 用户偏好与站点 profile 合并，以及显式全局偏好的优先级；
- `gitlabReferenceControlPosition` 向版本化配置的迁移和旧键清理；
- 保存失败时保留当前内存配置，恢复默认值时清理旧位置键；
- 保护配置不会被外部输入覆盖，不启用远程配置或敏感数据存储。

设置页测试覆盖以下行为：

- 表单控件转换为经过配置层校验的用户 patch；
- 初始化加载设置、保存成功反馈和恢复默认值；
- 浏览器存储写入失败时保留编辑内容并显示错误反馈。

内容脚本单元测试覆盖以下行为：

- Issue 复制 `#15`，MR 复制 `!14`；
- 原生按钮语义、无障碍名称、默认 tooltip 和独立 `aria-live` 播报；
- Clipboard API 成功、不可用、拒绝，以及 `execCommand('copy')` 降级；
- 降级返回 `false` 或抛出异常时显示“复制失败”，且临时输入节点始终移除；
- 成功和失败状态在 `1500ms` 后恢复，连续点击以最新结果为准；
- 使用编码后的项目路径请求同源 GitLab API，并携带当前站点登录会话；
- Issue/MR 并行加载、`X-Next-Page` 分页、详情 URL 回退和 API 数据校验；
- 当前条目高亮且不渲染为链接，其他条目使用当前标签页链接；
- 完整结果缓存默认 60 秒，缓存过期和“刷新列表”会重新请求；
- 初次部分失败显示成功分组，刷新部分失败保留完整旧快照；
- 鼠标停留 150ms 后打开，离开交互区域 250ms 后关闭；
- 键盘聚焦、Enter、Space、Escape、触摸切换、外部点击和焦点离开；
- 六点手柄语义、4px 拖动阈值、pointer capture 及拖动取消清理；
- 顶部、左侧、右侧吸附，边缘相对位置计算和窗口缩放后保持可见；
- `chrome.storage.local` 位置恢复、异常降级、双击复位和销毁时异步隔离；
- 控件位于不同边缘和高度时，列表向下、向上、向左或向右的窗口内侧展开；
- SPA 同项目缓存复用、跨项目隔离、离开详情页和 `destroy()` 清理；
- 复制与接口请求的旧异步结果均不会污染当前页面状态。

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

2026-08-08 实际结果：1 个端到端场景通过，0 项失败，0 项跳过。该场景同时覆盖
内容页和真实扩展设置页。

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
5. 编号和复制按钮都能被真实鼠标准确命中，打开列表前不会提前请求 API。
6. 悬停不足 150ms 时列表不打开；继续悬停后加载当前项目的 Issue 和 MR。
7. 列表按 Issues、Merge requests 分组，当前 Issue 使用非链接元素、高亮并显示
   “当前”，其他条目具有正确详情页链接。
8. 点击“刷新列表”后 Issue/MR 均重新请求，并显示更新后的数据。
9. 拖动六点手柄时列表关闭，控件吸附到右侧，列表随后向左展开且不超出窗口。
10. 页面重载后恢复右侧位置；双击手柄后恢复顶部居中并清除已存位置。
11. 悬停复制按钮时 tooltip 在按钮下方显示“复制 #123”；点击后剪贴板为 `#123`，
    图标在深色模式 hover 状态下仍变为绿色对勾。
12. 滚动到 `1800px` 后，标签顶部坐标与滚动前一致。
13. 键盘可以打开列表，Escape 关闭后焦点回到编号按钮。
14. SPA 风格切换到 MR 子页面后，唯一标签更新为 `MR !456`，缓存不重复请求，当前
    标记移到 MR，复制反馈和剪贴板内容同步更新。
15. 真实点击其他 MR 链接后在当前标签页跳转，固定编号同步更新。
16. 离开详情页进入 Issue 列表后，标签被移除。
17. 打开真实扩展设置页，确认 8 项默认值，保存一组非默认设置并在页面重载后确认
    持久化；恢复默认值后再次重载，确认默认值也已持久化。
18. 测试结束后扩展被卸载，WebDriver 会话、ChromeDriver、HTTP 服务与临时目录
    均被清理。

## 6. 手工验收

在 Chrome 150 和 Arc 1.157.1 中分别加载仓库根目录，然后执行：

1. 打开 `gitlab.com` 的一个登录态 Issue，确认文案、默认顶部居中位置、滚动行为和
   常驻复制图标。
2. 鼠标停在编号上，确认短暂延迟后显示当前项目所有 Open Issue/MR，Issue 分组在前。
3. 确认当前条目高亮并显示“当前”，点击不跳转；点击其他条目在当前标签页跳转。
4. 点击“刷新列表”，确认列表更新；一分钟内关闭后重开，确认缓存使列表快速显示。
5. 使用 Tab 聚焦编号，并测试 Enter、Space、Escape 和焦点离开时的打开、关闭行为。
6. 在触摸设备或设备模拟模式点击编号，确认列表可切换，点击外部可关闭。
7. 从六点手柄拖动控件，确认可自由移动并在松手后吸附到顶部、左侧或右侧；拖动时
   已打开的列表应关闭。
8. 分别从三个边缘打开列表，确认面板向窗口内侧展开且不超出可视区域；调整窗口
   尺寸后控件和面板仍保持可见。
9. 刷新页面并切换到其他项目，确认沿用同一吸附位置；双击手柄后恢复顶部居中，
   再次刷新仍保持默认位置。
10. 悬停和键盘聚焦复制按钮，确认 tooltip 位于按钮下方且文案为“复制 #编号”。
11. 点击 Issue 复制按钮，确认可粘贴 `#编号`，图标变为绿色对勾并自动恢复。
12. 打开 `gitlab.com` 的一个登录态 MR，确认显示 `MR !编号`，列表当前项随之更新，
   并可复制 `!编号`。
13. 在实际 HTTP 自建 GitLab（例如 `http://git.tsintergy.com`）重复导航和复制，确认
    GitLab API 使用现有登录态，Clipboard API 不可用时降级复制仍可工作。
14. 模拟离线或 API 失败，确认列表显示错误，但顶部编号和复制按钮仍可使用。
15. 从详情页使用 GitLab 页面内链接切换到另一个 Issue/MR，确认编号、列表当前项、
    复制文案和反馈状态同步更新。
16. 打开 Issue/MR 列表页、新建页、编辑页和普通网站，确认标签不显示。
17. 在浅色和深色系统主题下确认手柄、标签、列表、当前项和绿色对勾均清晰可辨。
18. 从扩展详情页打开设置，修改筛选、搜索记忆、缓存、数量、加载、刷新时间、触屏
    拖动和键盘步长选项，保存后刷新 GitLab 页面确认配置生效；搜索记忆字段当前由
    #3 消费。使用“恢复默认值”后确认行为回到默认值。

自动化使用本地 fixture，不访问账号或真实 GitLab 服务，因此不能替代以上对 Arc、
登录态 GitLab API、企业实例兼容性、定制主题及实际页面内导航的手工验收。这些是
当前测试边界，不影响 URL、DOM 生命周期、请求状态机和 Chromium 150 扩展安装机制
以及配置校验和设置页控制器的自动化覆盖。
