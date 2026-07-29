# GitLab Issue/MR 编号固定标签设计

## 1. 背景与目标

开发一个 Manifest V3 Chrome 扩展。在 GitLab Issue 或 Merge Request（MR）详情页中，即使用户向下滚动很远，当前条目的编号仍固定显示在浏览器视口顶部。

扩展必须同时兼容：

- `https://gitlab.com`
- 自建 GitLab 的 HTTP 或 HTTPS 域名，例如 `http://git.tsintergy.com`
- Chrome 150 与 Arc 1.157.1（Chromium 150）

首版不包含 Chrome Web Store 发布、弹窗、设置页、账号功能或任何网络服务。

## 2. 方案选择

采用“全站点内容脚本 + 严格 URL 识别”的方案。内容脚本匹配所有 HTTP/HTTPS 页面，以自动支持未知的自建 GitLab 域名；脚本只在 URL 符合 GitLab Issue/MR 详情路径时创建界面。

该方案的代价是安装时浏览器会显示“读取和更改所有网站上的数据”一类权限提示。首版接受该代价，以换取 `gitlab.com`、当前自建实例及未来其他自建实例无需配置即可使用。

扩展不发起网络请求、不持久化数据，也不读取账号、Issue 正文或评论内容。

## 3. 页面识别

URL 解析器作为独立、可单元测试的模块，识别以下结构：

- 现代 Issue：`/<namespace>/<project>/-/issues/<iid>`
- 现代 MR：`/<namespace>/<project>/-/merge_requests/<iid>`
- 旧式 Issue：`/<namespace>/<project>/issues/<iid>`
- 旧式 MR：`/<namespace>/<project>/merge_requests/<iid>`

其中：

- `<namespace>` 可以包含多层嵌套群组。
- `<iid>` 必须是正整数。
- 查询参数和锚点不影响识别。
- Issue/MR 的子页面仍显示所属编号，例如 MR 的 commits、diffs、pipelines 等路径。
- 列表页、新建页、编辑页及名称相似但不符合结构的页面不显示标签。
- HTTP 与 HTTPS 使用同一识别规则。

解析结果统一为 `{ kind, iid }`：Issue 的 `kind` 为 `issue`，MR 为 `merge-request`。URL 不匹配时返回 `null`。

## 4. 用户界面

页面匹配时，在视口顶部水平居中显示一个紧凑标签：

- Issue：`Issue #123`
- MR：`MR !456`

标签使用 `position: fixed`，因此不随文档滚动；使用足够高的 `z-index`，保证在 GitLab 页面之上可见。标签本身设置 `pointer-events: none`，不会拦截标签下方的按钮、链接或拖拽操作。

界面使用 Shadow DOM 隔离扩展样式与 GitLab 样式。配色同时适配浅色与深色系统主题，使用实色背景、清晰边框和轻量阴影。标签只占顶部中央的小范围，不修改页面布局，也不覆盖整条导航栏。

标签容器带稳定的扩展专用 ID，重复初始化时复用现有节点，避免产生多个标签。

## 5. 生命周期与导航

内容脚本在 `document_start` 注入，并在 DOM 可用后渲染。每次同步时执行以下流程：

1. 解析当前 `location.href`。
2. 若匹配 Issue/MR，创建或更新固定标签。
3. 若不匹配，移除标签。

GitLab 可能使用局部页面导航，因此扩展不能只依赖首次加载。扩展监听：

- `popstate` 与 `hashchange`
- GitLab/Turbo 常见的页面加载事件
- DOM 变化，用于兜底检测 URL 变化

DOM 观察回调只比较当前 URL；URL 未变化时不重新渲染。地址变化后合并到一次同步，避免频繁更新。这样从一个 Issue/MR 切换到另一个时会更新编号，离开详情页时会隐藏标签。

## 6. 项目结构

扩展保持无构建步骤，便于直接加载和检查：

- `manifest.json`：Manifest V3 配置、HTTP/HTTPS 匹配与图标声明。
- `src/parser.js`：纯 URL 解析逻辑，同时供浏览器和 Node 测试使用。
- `src/content.js`：标签渲染、导航监听与生命周期管理。
- `icons/`：扩展图标。
- `tests/`：Node 内置测试与浏览器级测试夹具。
- `README.md`：Chrome/Arc 安装、更新、权限和验证说明。

不引入运行时依赖。测试优先使用 Node 内置 `node:test`，浏览器验证使用本机可用的 Chromium 自动化能力。

## 7. 安全与隐私

扩展遵循以下约束：

- 不包含远程代码。
- 不调用 `fetch`、XHR、WebSocket 或第三方统计服务。
- 不申请 `storage`、`tabs`、`cookies`、`identity` 等无关权限。
- 不读取或保存 GitLab 页面正文、评论、用户信息或认证信息。
- 内容脚本仅解析 URL，并操作自己的标签节点。

README 必须解释广泛站点权限来自“自动兼容任意自建 GitLab 域名”，避免用户误解。

## 8. 测试与验收

### 8.1 自动化测试

URL 解析测试至少覆盖：

- `gitlab.com` 的 Issue 与 MR。
- `http://git.tsintergy.com` 的 Issue 与 MR。
- HTTPS 自建实例。
- 多层嵌套 namespace。
- 查询参数与锚点。
- MR/Issue 子页面。
- 列表、新建、编辑、非数字编号和近似路径等负例。

内容脚本测试或浏览器级验证至少覆盖：

- 匹配页面只生成一个标签，且文案正确。
- 页面滚动后标签仍固定在视口顶部。
- SPA 风格地址切换后编号更新。
- 离开 Issue/MR 页面后标签移除。
- 标签不捕获鼠标事件。

### 8.2 静态验收

- `manifest.json` 可被 JSON 解析，声明 `manifest_version: 3`。
- 内容脚本覆盖 `http://*/*` 与 `https://*/*`。
- 不声明无关扩展权限。
- 所有清单引用的脚本和图标均存在。

### 8.3 手工验收

在 Chrome 150 或 Arc Chromium 150 中加载未打包扩展后：

1. 打开 `gitlab.com` 的任意 Issue，确认顶部显示 `Issue #编号`。
2. 打开 `gitlab.com` 的任意 MR，确认顶部显示 `MR !编号`。
3. 在 `http://git.tsintergy.com` 重复上述验证。
4. 向下滚动超过一个视口，确认标签仍位于视口顶部。
5. 打开 GitLab 列表页或其他网站，确认不显示标签。

## 9. 完成标准

以下条件全部满足才算首版完成：

- 扩展可通过 Chrome 与 Arc 的“加载已解压的扩展程序”安装。
- `gitlab.com` 和任意 HTTP/HTTPS 自建 GitLab 的 Issue/MR 详情 URL 均可识别。
- 编号标签滚动时持续可见，且不阻挡页面交互。
- GitLab 局部导航后能正确更新或隐藏。
- 自动化测试、清单校验和可执行的浏览器验证通过。
- README 清楚说明安装方式、权限原因、支持路径和隐私行为。
