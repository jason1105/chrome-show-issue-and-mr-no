# GitLab Issue/MR Number Pin

一个无构建步骤的 Manifest V3 浏览器扩展。在 GitLab Issue 或 Merge Request
详情页顶部固定显示当前编号，页面滚动后仍保持可见：

- Issue 显示为 `Issue #123`
- Merge Request 显示为 `MR !456`

扩展兼容 `gitlab.com` 和任意 HTTP/HTTPS 自建 GitLab 域名，例如
`http://git.tsintergy.com`。目标浏览器为 Chrome 150 和 Arc 1.157.1
（Chromium 150）。

## 安装

### Chrome

1. 打开 `chrome://extensions`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库根目录，也就是包含 `manifest.json` 的目录。
5. 保持扩展开启，然后刷新已经打开的 GitLab 页面。

### Arc

1. 打开 `arc://extensions`（也可打开 `chrome://extensions`）。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库根目录。
5. 保持扩展开启，然后刷新已经打开的 GitLab 页面。

浏览器重启后扩展仍会保留。源码更新后，在扩展管理页点击该扩展的“重新加载”
按钮，并刷新 GitLab 页面即可应用新版本。

## 支持范围

扩展识别现代和旧式 GitLab URL，namespace 可以包含多层群组：

```text
https://gitlab.com/<namespace>/<project>/-/issues/<iid>
https://gitlab.com/<namespace>/<project>/-/merge_requests/<iid>
http://<self-hosted>/<namespace>/<project>/-/issues/<iid>
http://<self-hosted>/<namespace>/<project>/-/merge_requests/<iid>
```

旧式的 `/issues/<iid>` 和 `/merge_requests/<iid>` 路径也受支持。查询参数、
锚点和合法子页面（如 MR 的 `diffs`）不会影响编号显示。

列表页、新建页、编辑页、非法编号、非 HTTP/HTTPS URL 均不会显示标签。
扩展通过 URL 路径判断页面类型，因此非 GitLab 网站若使用完全相同的路径结构，
也可能显示标签。

## 权限与隐私

为了在安装后直接支持未知的自建 GitLab 域名，内容脚本匹配所有 HTTP 和 HTTPS
网站。因此 Chromium 会显示“读取和更改所有网站上的数据”一类权限提示。

扩展的实际行为仅包括解析当前页面 URL，以及创建、更新或移除自己的固定标签：

- 不发起网络请求；
- 不存储或上传数据；
- 不读取 Issue/MR 正文、评论、账号信息或认证信息；
- 不申请 `storage`、`tabs`、`cookies`、`identity` 等扩展 API 权限；
- 不包含远程代码、统计服务或运行时依赖。

实现可直接查看：[URL 解析器](src/parser.js)、[固定标签内容脚本](src/content.js)
和 [Manifest](manifest.json)。

## 开发与测试

运行单元测试和静态检查：

```bash
npm test
```

运行真实 Chromium 浏览器测试：

```bash
npm run test:browser
```

浏览器测试需要 Chrome/Chromium 和相同主版本的 ChromeDriver。可通过环境变量指定
可执行文件：

```bash
CHROME_PATH="/path/to/chrome" \
CHROMEDRIVER_PATH="/path/to/chromedriver" \
npm run test:browser
```

完整测试环境、覆盖矩阵、自动化结果与手工验收边界见
[测试文档](docs/testing.md)。设计和实施过程分别保留在
[设计文档](docs/superpowers/specs/2026-07-29-gitlab-reference-badge-design.md)与
[实施计划](docs/superpowers/plans/2026-07-30-gitlab-reference-badge-implementation.md)。
