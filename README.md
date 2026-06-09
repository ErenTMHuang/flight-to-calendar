# ✈️ 机票 → Google 日历

一个**纯前端**网页：登录 Gmail → 自动扫描机票/行程邮件 → 解析出航班 → 你核对后一键写入 **Google 日历**。

- 无需后端服务器，整站就是几个静态文件，**直接放 GitHub 仓库 + GitHub Pages 免费托管**。
- 所有数据只在你自己的浏览器和 Google 之间传输，不经过任何第三方服务器。
- 手机/电脑浏览器都能打开使用。

---

## 一、它是怎么工作的

```
你的浏览器
  │  ① Google 登录（OAuth）拿到临时令牌
  ├──► Gmail API   读取符合条件的邮件正文
  │  ② 解析航班（可选用 Gemini AI，更准）
  ├──► Gemini API  把邮件文本变成结构化航班信息
  │  ③ 你在网页上核对/修改
  └──► Calendar API 写入 Google 日历
```

文件说明：
| 文件 | 作用 |
|------|------|
| `index.html` | 页面与界面 |
| `styles.css` | 样式 |
| `app.js` | 主流程：登录、读 Gmail、写日历 |
| `parser.js` | 把邮件文本解析成航班（规则版 + Gemini 版） |

---

## 二、准备工作（一次性，约 10 分钟）

### 1. 创建 Google OAuth 客户端 ID（必须）

1. 打开 [Google Cloud Console](https://console.cloud.google.com/) → 新建一个项目。
2. 左侧 **API 和服务 → 已启用的 API** → 启用这两个：
   - **Gmail API**
   - **Google Calendar API**
3. 左侧 **OAuth 同意屏幕（OAuth consent screen）**：
   - 用户类型选 **外部（External）**。
   - 填应用名、你的邮箱即可。
   - **测试用户（Test users）** 里把你自己的 Gmail 地址加进去（重要！否则无法登录）。
   - 保持「测试 / Testing」状态即可，个人用不需要发布审核。
4. 左侧 **凭据（Credentials）→ 创建凭据 → OAuth 客户端 ID**：
   - 应用类型选 **Web 应用**。
   - **已获授权的 JavaScript 来源（Authorized JavaScript origins）** 添加你将访问网页的地址，例如：
     - 本地测试：`http://localhost:8000`
     - GitHub Pages：`https://你的用户名.github.io`
   - 创建后复制 **客户端 ID**（形如 `xxxx.apps.googleusercontent.com`）。

### 2.（可选，强烈推荐）拿一个 Gemini API Key

不用 Gemini 也能跑，但内置的规则解析对格式各异的机票邮件**很不准**。用 Gemini 准确度高很多，且有免费额度。

1. 打开 [Google AI Studio](https://aistudio.google.com/app/apikey) → **Create API key**。
2. 复制 key（形如 `AIza...`）。

> ⚠️ 这个 key 会保存在你浏览器本地。因为是纯前端，请勿把填好 key 的版本公开分享。

---

## 三、运行方式

### 方式 A：本地试用（最快）

在本文件夹下起一个静态服务器（任选其一）：

```powershell
# Python
python -m http.server 8000
# 或 Node
npx serve -l 8000
```

浏览器打开 `http://localhost:8000`，确保该地址已加进上面第 1 步的「JavaScript 来源」。

### 方式 B：部署到 GitHub Pages（推荐，长期用）

1. 新建一个 GitHub 仓库，把本文件夹所有文件传上去。
2. 仓库 **Settings → Pages** → Source 选 `main` 分支、根目录 `/`，保存。
3. 等一两分钟，访问 `https://你的用户名.github.io/仓库名/`。
4. 把这个网址加到第 1 步的「已获授权的 JavaScript 来源」里。

---

## 四、使用步骤

1. 打开网页，在「① 配置」里填 **OAuth 客户端 ID**（和可选的 Gemini Key），点 **保存配置**。
2. 点 **② 连接 Google 账号**，在弹窗里授权（首次会提示这是测试应用，点继续）。
3. 点 **③ 扫描机票邮件**，等它读邮件并解析。
4. 在「④ 解析结果」里**核对/修改**每个航班的字段（解析不一定 100% 准，务必看一眼）。
5. 点单个航班的 **添加到日历**，或右上角 **全部添加到日历**。

调整 **Gmail 搜索条件** 可以控制扫描范围，用的是 [Gmail 搜索语法](https://support.google.com/mail/answer/7190)，例如：
```
from:(airchina.com OR ctrip.com) newer_than:90d
subject:(行程单 OR e-ticket) newer_than:1y
```

---

## 五、常见问题

- **登录弹窗报 `redirect_uri` 或 `origin` 错误**：当前网址没加进 OAuth 客户端的「JavaScript 来源」。注意 `http`/`https`、端口、结尾不要带 `/`。
- **点登录后立刻被拒**：你的 Gmail 没加进 OAuth 同意屏幕的「测试用户」。
- **解析不准/解析不到**：填上 Gemini Key；放宽 Gmail 搜索条件；卡片里手动改字段。
- **时区**：事件按邮件里的「当地时间」写入，会用你 Google 日历的默认时区。跨时区航班建议核对到达时间。
- **重复添加**：目前不去重，重复点会建多个事件。

---

## 六、安全说明

- 这是纯前端应用，**没有后端**，你的邮件内容不会发到我或任何第三方，只在「你的浏览器 ↔ Google（↔ 你自己的 Gemini key）」之间传输。
- OAuth 客户端 ID 是公开信息，放在前端没问题。
- **Gemini Key 是私密的**，只存在你浏览器的 localStorage 里。不要把填了 key 的截图/代码公开。

---

## 七、后续可扩展

- 自动去重（按航班号+日期）。
- 支持往返/多段行程的智能合并。
- 改成 **GitHub Actions 定时任务**：每天自动扫描并写日历，完全无人值守（需要把令牌换成 service account 或 refresh token，逻辑同 `parser.js`）。
- 同时导出 `.ics` 文件，兼容苹果/Outlook 日历。
