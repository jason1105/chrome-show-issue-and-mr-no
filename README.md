# GitLab Issue/MR Number Pin

一个无构建步骤的 Manifest V3 浏览器扩展。在 GitLab Issue 或 Merge Request
详情页顶部固定显示当前编号，页面滚动后仍保持可见：

- Issue 显示为 `Issue #123`
- Merge Request 显示为 `MR !456`

编号右侧常驻一个类似 GitHub 仓库地址控件的复制按钮。鼠标悬停或键盘聚焦时会
显示 `复制 #123` 或 `复制 !456`；点击后分别复制 `#123` 或 `!456`，并将图标
短暂切换为绿色对勾和“已复制”提示。复制失败时会显示“复制失败”，所有反馈会在
1.5 秒后恢复。

鼠标悬停或键盘聚焦编号区域，会打开当前项目的全部 Open Issue 和 Open MR 列表：

- Issue 在前，MR 在后；
- 当前条目高亮显示“当前”，不重复跳转；
- 点击其他条目会在当前标签页打开对应详情页；
- “刷新列表”会绕过 60 秒内存缓存，立即获取最新结果。

触摸设备可点击编号区域打开或关闭列表。接口加载失败不会影响编号显示和快速复制。

编号左侧的六点手柄用于调整控件位置。拖动后控件会吸附到窗口顶部、左侧或右侧，
并在后续页面及浏览器重启后沿用同一位置；窗口尺寸变化时会自动保持在可视区域内。
双击手柄可恢复顶部居中。Open Issue/MR 列表会根据控件所在边缘向窗口内侧展开。

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

## 设置

在 `chrome://extensions` 或 `arc://extensions` 的扩展详情中点击“扩展程序选项”，
即可打开设置页。设置保存于当前浏览器配置文件的 `chrome.storage.local`，只在本机
生效，不会同步到服务器，也不会通过远程配置覆盖。

可调整的选项包括：

- 默认列表筛选：全部、仅 Issues 或仅 Merge requests；
- 是否记住列表搜索条件（由后续 #3 搜索功能消费）；
- 列表缓存有效期：5 到 300 秒，默认 60 秒；
- 每类最多显示数量：1 到 100，默认 100；
- 加载模式：并行加载或顺序加载；
- 是否显示最后刷新时间；
- 是否允许触屏拖动控件；
- 键盘移动步长：1 到 50 像素，默认 8 像素。

设置页提供“保存设置”和“恢复默认值”。输入值超出范围或不属于已知选项时，配置
层会自动恢复为合法值。浏览器存储写入失败时会保留当前页面内存中的新配置并提示
保存失败；重新加载扩展或页面后仍以浏览器中实际保存的配置为准。

配置结构预留了站点级 profile，但当前设置页只编辑全局用户偏好。搜索条件记忆字段
已纳入统一契约，实际搜索交互由 #3 接入。全局用户明确保存
的字段优先于站点 profile；列表筛选、请求数量、加载方式等设置不会关闭 SPA 旧响应
隔离、配置校验、敏感数据保护等安全和生命周期约束。

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

扩展会解析当前页面 URL，创建、更新或移除自己的固定标签，并在用户首次打开导航
列表时请求当前站点的同源 GitLab REST API v4：

- 请求仅用于读取当前项目的 Open Issue 和 Open MR；
- 请求复用浏览器已有的 GitLab 登录会话，不读取或存储 token、Cookie 及其他认证
  信息；
- 仅在当前页面内存中缓存 IID、标题和详情 URL，缓存有效期默认 60 秒，可在设置页
  调整为 5 到 300 秒；
- 使用 `storage` 权限在本机保存一份跨项目共享的控件位置，内容为吸附边缘和边缘
  相对比例 `{ edge, ratio }`，以及经过校验的用户偏好配置；
- 不读取 Issue/MR 正文、评论或账号资料，不持久化 Issue/MR 列表、正文、Cookie、
  token 或其他认证信息，也不上传数据；
- 配置版本化存储在单个 `gitlabReferenceConfig` 键中；旧版本的
  `gitlabReferenceControlPosition` 会在读取时迁移并清理；
- 配置层不接受远程配置，不存储敏感数据，单次列表请求最多读取每类 100 项；
- 复制时仅将当前 URL 中解析出的 `#编号` 或 `!编号` 写入本机剪贴板；
- 不申请 `tabs`、`cookies`、`identity` 等扩展 API 权限；
- 不包含远程代码、统计服务或运行时依赖。

导航接口返回错误、不可用或当前会话无权访问时，列表会显示失败状态，但固定编号和
复制功能保持可用。位置存储失败时也不影响当前页面内的拖动和复位。

扩展优先使用浏览器 Clipboard API。对于不具备安全上下文 Clipboard API 的 HTTP
自建 GitLab，会自动使用浏览器内置的本地复制降级方式；该能力不需要增加扩展
权限，也不会改变上述隐私模型。

实现可直接查看：[URL 解析器](src/parser.js)、[配置层](src/config.js)、[固定标签内容脚本](src/content.js)、
[设置页](src/options.html) 和 [Manifest](manifest.json)。

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
[测试文档](docs/testing.md)。基础标签的设计和实施过程分别保留在
[标签设计文档](docs/superpowers/specs/2026-07-29-gitlab-reference-badge-design.md)与
[标签实施计划](docs/superpowers/plans/2026-07-30-gitlab-reference-badge-implementation.md)；
快速复制功能对应
[复制设计文档](docs/superpowers/specs/2026-07-31-gitlab-reference-quick-copy-design.md)与
[复制实施计划](docs/superpowers/plans/2026-07-31-gitlab-reference-quick-copy-implementation.md)；
项目内 Open Issue/MR 导航对应
[导航设计文档](docs/superpowers/specs/2026-07-31-gitlab-open-items-navigation-design.md)与
[导航实施计划](docs/superpowers/plans/2026-07-31-gitlab-open-items-navigation-implementation.md)。
