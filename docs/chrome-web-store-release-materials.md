# Chrome Web Store 发布材料包

## 发布包
- **文件**：`dist/chrome-show-issue-and-mr-no-v1.0.0.zip` (50KB)
- **验证状态**：已通过 SMOKE TEST ✓
- **内容**：manifest.json + src/ + _locales/ + icons/

## 商店信息

### 扩展名称
```
GitLab Issue/MR Number Pin
```

### 简短描述（128字符限制）
```
Show issue/MR numbers directly on GitLab pages. Works with self-hosted GitLab. Clear badges, custom styles, zero setup.
```
（当前 120 字符 ✓）

### 详细说明 - 英文版
```markdown
## GitLab Issue/MR Number Pin

Instantly see issue and merge request numbers on any GitLab page—no extra clicks needed.

### Key Features
- **Zero Configuration**: Works out of the box on gitlab.com and self-hosted instances
- **Clean Badges**: Issue/MR numbers displayed as clear, color-coded badges
- **Quick Navigation**: Click badges to jump directly to referenced issues or merge requests
- **Filter Panel**: Built-in panel to filter and highlight specific issue/MR numbers
- **Custom Styles**: Customize badge colors, position, and visibility
- **Full Repository Mode**: Optionally show badges on all repository pages (enabled by default)

### Privacy First
- All data stored locally in your browser
- No external servers, no tracking, no data collection
- Works entirely offline after installation
- Open source: review the code yourself

### Supported Pages
- Issue pages
- Merge request pages
- Repository file browser
- Commit pages
- Pipeline pages
- Wiki pages

Perfect for developers, code reviewers, and teams working with GitLab daily.
```

### 详细说明 - 中文版（可选）
```markdown
## GitLab Issue/MR Number Pin

在任意 GitLab 页面即时显示议题和合并请求编号——无需额外点击。

### 核心功能
- **零配置**：开箱即用，支持 gitlab.com 和私有部署实例
- **清晰徽章**：议题/MR 编号以彩色徽章清晰展示
- **快速导航**：点击徽章直达引用的议题或合并请求
- **过滤面板**：内置面板可筛选和高亮特定议题/MR 编号
- **自定义样式**：可自定义徽章颜色、位置和可见性
- **全仓库模式**：可选择在所有仓库页面显示徽章（默认开启）

### 隐私优先
- 所有数据本地存储在浏览器中
- 无外部服务器、无追踪、无数据收集
- 安装后完全离线工作
- 开源：可自行审阅代码

### 支持页面
- 议题页面
- 合并请求页面
- 仓库文件浏览器
- 提交记录页面
- 流水线页面
- Wiki 页面

非常适合每天使用 GitLab 的开发者、代码审查者和团队。
```

## 隐私政策

### Privacy Policy
```markdown
# Privacy Policy for GitLab Issue/MR Number Pin

**Effective Date**: August 22, 2026

## Data Collection
This extension does **not collect, transmit, or share any user data**.

## Data Storage
- All user preferences and settings are stored locally in your browser using Chrome's `storage.sync` API
- Data stored includes: custom badge styles, filter preferences, visibility settings
- No data is sent to external servers
- No analytics, tracking, or telemetry

## Permissions Explained
- **storage**: Required to save your preferences locally
- **scripting**: Required to display badges on GitLab pages
- **host permissions** (optional): Requested only when you visit a GitLab instance, used solely to read and display issue/MR numbers on those pages

## Open Source
The complete source code is available at: http://git.tsintergy.com:8070/lvwei/chrome-show-issue-and-mr-no

## Contact
For questions or concerns, please open an issue on the project repository.
```

### 隐私政策 - 中文版（可选）
```markdown
# GitLab Issue/MR Number Pin 隐私政策

**生效日期**：2026年8月22日

## 数据收集
本扩展**不收集、传输或分享任何用户数据**。

## 数据存储
- 所有用户偏好和设置使用 Chrome 的 `storage.sync` API 本地存储在您的浏览器中
- 存储的数据包括：自定义徽章样式、过滤偏好、可见性设置
- 不向外部服务器发送任何数据
- 无分析、追踪或遥测

## 权限说明
- **storage**：保存您的偏好设置到本地所需
- **scripting**：在 GitLab 页面上显示徽章所需
- **主机权限**（可选）：仅在您访问 GitLab 实例时请求，仅用于读取和显示这些页面上的议题/MR 编号

## 开源
完整源代码可在此查看：http://git.tsintergy.com:8070/lvwei/chrome-show-issue-and-mr-no

## 联系方式
如有疑问或问题，请在项目仓库中提交 issue。
```

## 分类和语言设置

### Category（类别）
```
Developer Tools
```

### Languages（语言）
- **Primary**: English (en)
- **Secondary**: Chinese - Simplified (zh_CN)

## 图标和截图

### 图标（已包含在发布包）
- 16x16: `icons/icon-16.png`
- 32x32: `icons/icon-32.png`
- 48x48: `icons/icon-48.png`
- 128x128: `icons/icon-128.png`

### 截图（推荐准备）
建议上传 1-2 张截图展示：
1. 议题/MR 页面上的徽章显示效果
2. 过滤面板功能演示
3. 自定义样式选项

推荐尺寸：1280x800 或 640x400

## 上传指引

### 开发者控制台入口
https://chrome.google.com/webstore/devconsole

### 上传步骤
1. 登录开发者控制台
2. 点击"新增项目"
3. 上传 `dist/chrome-show-issue-and-mr-no-v1.0.0.zip`
4. 填写商店信息（复制上述内容）
5. 上传图标和截图
6. **保存为草稿**，预览商店页面效果
7. 确认无误后提交审核

### 预览功能
- 上传后可查看**商店页面预览**
- 可保存为**草稿**状态反复编辑
- 提交审核前可随时修改
- 支持**不公开**或**受信任测试者**模式内测

### 审核时长
- 通常 1-3 个工作日
- 可能需要补充材料或修改

## 检查清单
- [x] 发布包准备完成（50KB，已验证）
- [x] 商店名称确定
- [x] 简短描述（120字符 ✓）
- [x] 详细说明（中英文）
- [x] 隐私政策（中英文）
- [x] 分类和语言设置
- [x] 图标已包含
- [ ] 截图待上传时准备
- [x] 开发者账号已注册

## 备注
- manifest.json version: 1.0.0
- manifest version: 3
- permissions: storage, scripting
- host_permissions: optional (用户访问时授权)
