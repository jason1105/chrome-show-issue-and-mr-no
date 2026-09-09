# Edge Add-ons 上架物料清单（issue #6）

> dev 交付 · 2026-09-09 · 基线 `github/main` @ `9618e6e`（PR #37 合并后）。
> 对应 issue #6「Multi-browser support」Edge 段的收尾物料：Phase 1 真机冒烟已 **8/8 PASS**（见 `docs/edge-phase1-conclusion-dev2.md`），本文档给出可直接粘贴进 Edge Add-ons 开发者门户的上架文案与物料清单。
> **引用纪律**：本文档引用的所有仓库内路径均为 git 已跟踪文件，可用 `git ls-files` 复核；未落仓的本机物料一律显式标注「未跟踪」。

---

## 一、上架基本信息（Store listing）

### 1. 应用名（Name）

```
GitLab Issue/MR Number Pin
```

- 与 manifest `__MSG_extName__`（`_locales/en/messages.json` → `extName.message`）完全一致，Edge 装载后浏览器扩展管理页显示名与商店名不会漂移。
- 简体中文名（若门户开通中文商店条目时使用）：`GitLab Issue/MR 编号图钉`（`_locales/zh_CN/messages.json` → `extName.message`）。
- 建议上架前在门户搜索框确认 Edge Add-ons 上无同名条目（Chrome 商店已确认无冲突，Edge 侧未查）。

### 2. 短描述（Short description）

```
Show issue/MR numbers directly on GitLab pages. Works with self-hosted GitLab. Clear badges, custom styles, zero setup.
```

- 120 字符，沿用 Chrome 版文案（与 manifest `__MSG_extDescription__` 语义一致但更营销向）。
- Edge 门户字数上限若比 Chrome 的 132 更严，**以门户实际提示为准**；超限时的截断优先级：保留前两句（功能 + 私有部署兼容），删第三句卖点。

### 3. 长描述（Full description）

**English（主）：**

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
- Works entirely offline after installation (except fetching your own GitLab data)
- Open source: review the code yourself

### Supported Pages
- Issue pages
- Merge request pages
- Repository file browser
- Commit pages
- Pipeline pages
- Wiki pages

Perfect for developers, code reviewers, and teams working with GitLab daily.

### Verified on Microsoft Edge
Tested on Edge 152 (Windows/macOS family, Chromium engine): load, badge, panel, settings and per-instance authorization all pass a dedicated Edge smoke suite. See the linked repository for evidence logs.
```

**简体中文（可选，若开通 zh-CN 条目）：**

```markdown
## GitLab Issue/MR 编号图钉

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
- 安装后除访问您自己的 GitLab 外完全离线工作
- 开源：可自行审阅代码

### 支持页面
- 议题页面、合并请求页面、仓库文件浏览器、提交记录页面、流水线页面、Wiki 页面

非常适合每天使用 GitLab 的开发者、代码审查者和团队。
```

- 长描述与 Chrome 版唯一措辞差异：把「Works entirely offline after installation」补了一句限定（"except fetching your own GitLab data"），避免与主机权限声明自相矛盾——此修正同样建议回灌 Chrome 版（见 §四差异点 6）。
- 末段「Verified on Microsoft Edge」为 Edge 版独有增补，引用仓内真实证据（见 §三）。

### 4. 分类（Category）

```
Developer Tools
```

- 与 Chrome 版一致。Edge 门户分类词表与 Chrome Web Store 同源近邻，Developer Tools 在两侧均有对应项；若门户显示为本地化词（如「开发人员工具」），选同义项即可。

### 5. 语言（Languages）

| 项 | 值 | 来源 |
|---|---|---|
| Primary | English (en) | `manifest.json` → `default_locale: "en"` |
| Secondary | Chinese - Simplified (zh_CN) | `_locales/zh_CN/` |

### 6. 图标

发布包内已含（`manifest.json` → `icons`），门户无需单独上传小图标；商店主图请使用 128px：

- `icons/icon-16.png` / `icons/icon-32.png` / `icons/icon-48.png` / `icons/icon-128.png`（均已跟踪，随包提交）

---

## 二、隐私声明要点（Privacy declaration）

Edge 门户的隐私问卷按「收集/不收集」申报，本扩展按以下要点填写（与 `manifest.json` 实测权限一一对应）：

1. **不收集、不传输、不共享任何用户数据**。无账号体系、无分析、无遥测、无外部服务器。
2. **数据仅存本机浏览器**：扩展使用 `chrome.storage.local` 与 `chrome.storage.sync`（`src/` 内两类调用均有），存储内容仅限：徽章样式/位置偏好、列表筛选与搜索记忆、缓存 TTL 等设置项、已授权实例列表。
   - `storage.sync` 会经由微软/谷歌账号同步机制在用户自己的设备间同步偏好——申报时若问卷问「是否同步到云端」，如实勾选并说明「仅用户自身浏览器间同步偏好，不出现在开发者服务器」。
3. **权限说明（照抄问卷答复口径）**：
   - `storage`：本地保存用户偏好。
   - `scripting`：在用户授权的 GitLab 页面注入徽章 UI。
   - `optional_host_permissions: http://*/* + https://*/*`：**并非安装即全量授权**——仅当用户在选项页/权限气泡中逐个授权 GitLab 实例后才对该 origin 生效，可随时撤销（`src/options.js` 的 revoke 流程）。问卷「访问网站数据」按「用户明确选择后访问」申报。
4. **不读取用户 GitLab 凭证**：扩展复用浏览器会话 Cookie 调用用户已登录实例的公开 REST 端点，仅读取 issue/MR 的编号与标题，不上传任何内容到第三方。
5. **隐私政策 URL**：门户要求填 `Privacy Policy URL` 时，指向仓库内政策文档。注意：Chrome 材料草案里写的是 GitLab 镜像地址（内网 `git.tsintergy.com:8070`，公网不可达），**Edge 上架必须换成公网可达 URL**——推荐 GitHub 真源 `https://github.com/jason1105/chrome-show-issue-and-mr-no`（见 §四差异点 4）。
6. 「Single purpose」描述（Edge 门户必填项）建议口径：
   > Keeps the current GitLab issue or merge-request number visible while you browse GitLab, including self-hosted instances.

> 判定依据可在仓内复核：`grep -rn "storage\.\(local\|sync\)" src/`（storage 调用点）；`git show HEAD:manifest.json`（permissions 与 optional_host_permissions）。

---

## 三、截图清单（Screenshots）

### 商店上架截图（选 3–5 张，均为已跟踪、1280x800，符合门户推荐宽度 ≥1280）

**优先推荐（最新 UI 状态，P0 整改后）：**

| 文件（仓库路径） | 内容 | 用途 |
|---|---|---|
| `screenshots/issue11-release/issue11-01-main-panel.png` | 主面板展开（编号列表 + 徽章） | 首图 |
| `screenshots/issue11-release/issue11-02-panel-expanded.png` | 面板完整态（类型/状态筛选行） | 功能图 |
| `screenshots/issue11-release/issue11-03-badge-scroll.png` | 滚动时徽章钉住效果 | 卖点图 |
| `screenshots/issue11-release/issue11-04-focus-visible.png` | 焦点可见性（无障碍卖点） | 加分图 |
| `screenshots/issue11-release/preview-grid.png` | 四图总览拼板（1282x906） | 备用/评审 |

**备用（较早的 store 系列，同为 1280x800、已跟踪；含选项页，若需展示设置页则选用）：**

| 文件 | 内容 |
|---|---|
| `screenshots/store/04-options-page.png` | 选项页（设置 + 实例授权） |
| `screenshots/store/01-main-panel.png` … `screenshots/store/05-badge-scroll.png` | 与 issue11 系列同题旧版 |

> 两套截图的 UI 差异：`issue11-release/` 为 issue #11 P0 整改后重新拍摄（状态筛选迁入面板等新交互），`store/` 系列为整改前版本。上架一律用 issue11 系列，store 系列仅作历史对照——这是从 Chrome 材料复用时最容易踩的陈旧物料坑。

### 兼容性证据（门户审核被质询「Edge 验证过吗」时的仓内弹药，全部已跟踪）

结论与索引：`docs/edge-phase1-conclusion-dev2.md`（Edge 152.0.4191.62 真机 8/8 PASS，扩展 id `ceikgpeomcdgolonadmojochagppfejh`）+ `docs/evidence/issue-6-dline/README.md`（文件↔定桩映射与复现命令）。

| 证据文件（`docs/evidence/issue-6-dline/`） | 证明内容 |
|---|---|
| `edge-smoke-full.log` / `edge-smoke-full2.log` | 全量冒烟两次独立运行 PASS=8 FAIL=0 |
| `edge-read1.log` | 真 SW 回收后 badge 仍 `"!"`（决定性单条） |
| `edge-stop4.log` / `edge-stopui.log` | 方法论原始记录（SW 句柄读值假象的排除过程） |
| `edge-idle-evidence.json` + `edge-idle-probe-run.log` | 自然 idle 回收 → 唤醒重派生（#22 收口） |
| `chrome-baseline-run1.log` / `chrome-baseline-run2.log` / `chrome-diag7.log` | Chrome 对照环境限制记录（与 Edge 结论无关，防误读） |
| `README.md` | 索引 + 复现命令（依赖 `scripts/edge-phase1-smoke.mjs`、`scripts/stopui.mjs`、`scripts/edge-badge-persist-diag.mjs`、`scripts/edge-idle-wake-probe.mjs`，均已跟踪） |

---

## 四、与 Chrome 版的差异点

| # | 差异 | 说明 / 处置 |
|---|---|---|
| 1 | **开发者门户与流程** | Chrome 用 `chrome.google.com/webstore/devconsole`；Edge 用 `Microsoft Edge 扩展开发者门户`（`microsoftedge.microsoft.com/addons/developers`，入口以门户现状为准）。Edge 注册费低（个人免费），无需 Chrome 的 $5 一次性费用。包格式同为 zip（manifest v3 原样打包），Edge 不需要 CRX。 |
| 2 | **manifest 零改动** | Edge 与 Chrome 同为 Blink/Chromium，本项目 `manifest.json`（MV3、`default_locale: en`、`__MSG_*__` i18n 占位）在 Edge 真机加载验证通过，**无 gecko.id、无 Edge 专属键**。这正是 #6 对 Edge 的预期——差异全在门户侧，不在代码侧。 |
| 3 | **审核节奏与抽样复核** | Edge 审核通常 1–7 个工作日（门户实际为准）；上架后微软会对权限与主机声明做人工复核，per-instance 可选授权模型（§二.3）是被审核认可的形态，申报材料务必强调「optional + 用户逐个授权 + 可撤销」。 |
| 4 | **开源链接 / 隐私政策 URL** | Chrome 草案引用的 GitLab 镜像是内网地址；Edge 条目面向公网，一律用 GitHub 真源。若 admin 决定不公开 GitHub，则需在公开处放一份 standalone 隐私政策页再填该 URL——**此项需 manager/admin 裁决后填入**。 |
| 5 | **badge 跨完全重启回 `""`** | 未打包 `--load-extension` 下的平台语义（内存态不落盘），与上架包形态无直接对应；产品级恢复由 #22 boot 重派生承载（`docs/edge-phase1-conclusion-dev2.md` §三）。上架物料**不需**也**不应**声明「重启后钉住状态保留」。 |
| 6 | **长描述离线措辞** | 本文档 §一.3 已加「except fetching your own GitLab data」限定；Chrome 商店后续更新版本时建议同步，两商店文案保持一致性。 |
| 7 | **测试环境限制备忘** | Chrome stable 禁 `--load-extension` 加载未打包扩展而 Edge 放行，故 Phase 1 自动化冒烟只在 Edge/CfT 跑；这是开发侧手段差异，与上架无关，但解释了为何 Edge 证据反而比 Chrome 更完备。 |

---

## 五、上架前检查清单

- [ ] 发布包：以 `github/main` @ 当前 HEAD 打包 `manifest.json + src/ + _locales/ + icons/`（Chrome 侧既有手法 `scripts/package-smoke.mjs`，已跟踪；产物 zip 不入库，本机 `dist/` 为**未跟踪**物料）
- [ ] 门户账号：Microsoft Edge 开发者门户注册完成（与 §四.1）
- [ ] 名称/短描述/长描述/分类/语言：按 §一 填入
- [ ] 隐私问卷：按 §二 口径填写；隐私政策 URL 待 §四.4 裁决
- [ ] 截图：`screenshots/issue11-release/` 三张以上（首图必为 01-main-panel）
- [ ] 商店条目「支持自托管 GitLab」表述复核：与 optional host 模型一致，不暗示自动访问所有网站
- [ ] 提交前用门户预览检查 zh_CN 名与 en 名不互相覆盖

> 本文档为纯文档交付（issue #6 Edge 收尾窗口），不改 `src/`、`tests/`、`scripts/`；文中引用的 Chrome 侧原始材料 `docs/chrome-web-store-release-materials.md` 为**本机未跟踪草案**，其有效内容已全部收编进本文档，不再依赖该文件。
