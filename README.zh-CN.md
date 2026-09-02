<p align="center">
  <img src="icons/icon-128.png" alt="GitLab Issue/MR Number Pin" width="96" />
</p>

<h1 align="center">🩷 GitLab Issue/MR Number Pin</h1>

<p align="center">
  <em>在 GitLab 页面顶部固定显示当前 Issue / MR 编号，滚动不丢失，一键复制！</em>
</p>

<div align="center">

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/dmkkdfokknoilapcghjnncnehagcnfcc?label=Chrome%20Web%20Store&style=for-the-badge&color=4479C1)](https://chromewebstore.google.com/detail/gitlab-issuemr-number-pin/dmkkdfokknoilapcghjnncnehagcnfcc)
[![Chrome Web Store Users](https://img.shields.io/chrome-web-store/users/dmkkdfokknoilapcghjnncnehagcnfcc?label=Users&style=for-the-badge&color=4479C1)](https://chromewebstore.google.com/detail/gitlab-issuemr-number-pin/dmkkdfokknoilapcghjnncnehagcnfcc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/jason1105/chrome-show-issue-and-mr-no?style=for-the-badge&color=4CAF50)](https://github.com/jason1105/chrome-show-issue-and-mr-no)
[![GitHub release](https://img.shields.io/github/v/release/jason1105/chrome-show-issue-and-mr-no?style=for-the-badge&color=FF5722)](https://github.com/jason1105/chrome-show-issue-and-mr-no/releases)

</div>

---

> 🌍 简体中文 · [English](README.md) ｜ 📦 零构建、零追踪、零数据上传的 Manifest V3 扩展

---

## 📖 简介

**GitLab Issue/MR Number Pin** 是一个无构建步骤的 **Manifest V3** 浏览器扩展，专为频繁在 GitLab Issue / Merge Request 之间切换的开发者设计。

当你在 GitLab 的 Issue 或 MR 详情页来回跳转时，总会被「等一下，我现在看的是哪个编号？」所困扰。这个扩展在页面**顶部**固定显示当前编号标签，**页面滚动后依然保持可见**，让你随时明确自己身处哪个 Issue / MR。

| Issue | Merge Request |
|-------|---------------|
| 显示为 `Issue #123` | 显示为 `MR !456` |

<p align="center">
  <img src="screenshots/store/01-main-panel.png" alt="主面板" width="90%" />
</p>

---

## ✨ 功能特性

### 🏷️ 悬浮编号标签

- 在 Issue/MR 详情页顶部**固定显示当前编号**，页面滚动依旧可见
- 自动识别现代与旧式 GitLab URL，支持多层 namespace（群组）
- 兼容 `gitlab.com` 与任意 HTTP/HTTPS 自建 GitLab 域名

### 📋 一键快速复制

- 编号右侧常驻**复制按钮**（类似 GitHub 仓库地址控件）
- 悬停/聚焦显示 `复制 #123` / `复制 !456`，点击复制对应编号
- 复制成功显示绿色对勾 +「已复制」；失败提示「复制失败」，1.5s 后自动恢复
- 非安全上下文（HTTP）下自动使用浏览器内置降级复制，无需额外权限

### 🔎 项目内 Open Issue/MR 导航

- 悬停/聚焦编号区域，展开当前项目**全部 Open Issue 与 Open MR 列表**
- Issue 在前、MR 在后；当前条目高亮「当前」，点击其他条目跳转详情页
- **标题关键字搜索**；支持 `#123` / `!456` 精确查找；纯数字默认匹配编号或标题（可设仅编号）
- 「全部 / Issue / MR」类型筛选，搜索与筛选均在**本地完成**，不增加 API 请求
- 「刷新列表」绕过 60s 内存缓存，立即获取最新结果

### 🖱️ 可拖拽控件 + 位置记忆

- 左侧六点手柄可拖动，控件吸附到窗口顶部/左侧/右侧
- 位置跨页面、浏览器重启后沿用；窗口尺寸变化自动保持可视
- 双击手柄恢复顶部居中；列表根据控件所在边缘向内展开

### 🌐 全仓库模式 (Full-repo mode)

- 开启后可在**所有仓库页面**生效（不局限于详情页），工单编号悬浮提示随处可用

### 🧩 多语言 & 自定义设置

- 内置多语言（`.i18n`），跟随浏览器语言
- 设置页可调默认列表筛选、搜索范围、缓存有效期、加载方式等

### ⚡ 无构建 · 零依赖 · 零追踪

- 无构建步骤、无远程代码、无统计服务、无运行时依赖
- 权限最小化：`storage` + `scripting`，主机权限全 optional

---

## 🛠️ 安装

### ✅ 方式一：Chrome Web Store（推荐）

<div align="center">

[![Chrome Web Store](https://img.shields.io/badge/安装%20Install%20from%20Chrome%20Web%20Store-4479C1?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/gitlab-issuemr-number-pin/dmkkdfokknoilapcghjnncnehagcnfcc)

</div>

直达商店页：<https://chromewebstore.google.com/detail/gitlab-issuemr-number-pin/dmkkdfokknoilapcghjnncnehagcnfcc>

### 📦 方式二：手动加载（开发者）

#### Chrome

1. 打开 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本仓库根目录（包含 `manifest.json` 的目录）
5. 保持扩展开启，刷新已打开的 GitLab 页面

#### Arc

1. 打开 `arc://extensions`（或 `chrome://extensions`）
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本仓库根目录，刷新 GitLab 页面

> 💡 浏览器重启后扩展仍保留。源码更新后，在扩展管理页点击「重新加载」并刷新 GitLab 页面即可应用新版本。

---

## ⚙️ 使用与配置

在扩展详情页点击「扩展程序选项」打开设置页，设置保存于 `chrome.storage.sync`，随 Chrome 账号同步，卸载重装自动恢复，**不会被远程配置覆盖**。

| 可调选项 | 说明 | 默认 |
|---------|------|------|
| 默认列表筛选 | 全部 / 仅 Issues / 仅 Merge requests | 全部 |
| 记住搜索词与筛选 | 刷新、重开页面、重启后恢复 | 开 |
| 搜索范围 | 纯数字匹配「标题与编号」或「仅编号」 | 标题与编号 |
| 列表缓存有效期 | 5 ~ 300 秒 | 60 秒 |
| 每类最大显示数量 | 1 ~ 100 | 100 |
| 加载模式 | 并行 / 顺序 | 并行 |
| 显示最后刷新时间 | 面板显示刷新时间 | 开 |
| 允许触屏拖动 | 触屏设备可拖控件 | 开 |
| 键盘移动步长 | 1 ~ 50 像素 | 8 像素 |

> ⚙️ 设置页提供「保存设置」与「恢复默认值」；输入值越界或非法时配置层自动恢复合法值。

---

## 📸 截图

<p align="center">
  <img src="screenshots/store/01-main-panel.png" alt="主面板" width="45%" />
  <img src="screenshots/store/02-panel-state-filter.png" alt="状态筛选" width="45%" />
</p>

<p align="center">
  <img src="screenshots/store/03-panel-search.png" alt="搜索" width="45%" />
  <img src="screenshots/store/04-options-page.png" alt="设置页" width="45%" />
</p>

<p align="center">
  <img src="screenshots/store/05-badge-scroll.png" alt="滚动悬浮" width="90%" />
</p>

---

## 🔐 权限与隐私

为了在安装后直接支持未知的自建 GitLab 域名，内容脚本匹配所有 HTTP/HTTPS 网站，因此 Chromium 会显示「读取和更改所有网站上的数据」提示。

- 仅解析当前页面 URL，创建/更新/移除固定标签
- 首次打开导航列表时，请求当前站点**同源** GitLab REST API v4，仅读取当前项目的 Open Issue/MR
- 复用浏览器已有 GitLab 登录会话，**不读取或存储 token、Cookie** 及认证信息
- 仅内存缓存 IID、标题、详情 URL（默认 60s，可调 5~300s）
- 使用 `storage` 权限保存控件位置 `{ edge, ratio }` 与用户偏好、搜索词、类型筛选
- **不读取** Issue/MR 正文、评论、账号资料；**不上传任何数据**
- 不申请 `tabs`、`cookies`、`identity` 等权限；**不含远程代码、统计、运行时依赖**

> 🛡️ 零数据收集 · 零远程代码 · 配置版本化 · 单次最多读取每类 100 项

**实现源码**：[URL 解析器](src/parser.js) · [配置层](src/config.js) · [内容脚本](src/content.js) · [设置页](src/options.html) · [Manifest](manifest.json)

---

## 🧑‍💻 开发与测试

运行单元测试与静态检查：

```bash
npm test
```

运行真实 Chromium 浏览器测试：

```bash
npm run test:browser
```

浏览器测试需 Chrome/Chromium 与相同主版本的 ChromeDriver，可用环境变量指定可执行文件：

```bash
CHROME_PATH="/path/to/chrome" \
CHROMEDRIVER_PATH="/path/to/chromedriver" \
npm run test:browser
```

完整测试环境、覆盖矩阵、自动化结果与手工验收边界见 [测试文档](docs/testing.md)。

**设计/实施文档**：

- 基础标签：[设计](docs/superpowers/specs/2026-07-29-gitlab-reference-badge-design.md) · [实施](docs/superpowers/plans/2026-07-30-gitlab-reference-badge-implementation.md)
- 快速复制：[设计](docs/superpowers/specs/2026-07-31-gitlab-reference-quick-copy-design.md) · [实施](docs/superpowers/plans/2026-07-31-gitlab-reference-quick-copy-implementation.md)
- 导航：[设计](docs/superpowers/specs/2026-07-31-gitlab-open-items-navigation-design.md) · [实施](docs/superpowers/plans/2026-07-31-gitlab-open-items-navigation-implementation.md)

---

## 🤝 贡献

欢迎提交 Issue 与 Pull Request！请遵循：

1. Fork 本仓库并新建特性分支
2. 提交前运行 `npm test` 确保通过
3. 提交 PR 时清晰描述改动与自测证据
4. 保持权限最小化与零远程代码原则

---

## 📄 License

本项目基于 **MIT License** 开源，详见 [LICENSE](LICENSE) 文件。

`Copyright (c) 2026 jason1105`

---

## 🙏 致谢

感谢所有使用、测试与反馈的开发者。如果这个扩展帮到你，欢迎点亮 ⭐！
