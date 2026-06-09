/*
 * app.js — 主流程：Google 登录 → 拉 Gmail → 解析 → 渲染 → 写入 Google 日历。
 * 纯前端，无后端。所有调用直接用浏览器里的 OAuth access token 走 fetch。
 */

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

let tokenClient = null;
let accessToken = null;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  clientId: $("client-id"),
  geminiKey: $("gemini-key"),
  gmailQuery: $("gmail-query"),
  maxResults: $("max-results"),
  saveConfig: $("save-config"),
  connectBtn: $("connect-btn"),
  scanBtn: $("scan-btn"),
  authStatus: $("auth-status"),
  resultsSection: $("results-section"),
  results: $("results"),
  addAllBtn: $("add-all-btn"),
  log: $("log"),
};

// ---------- 配置持久化（localStorage）----------
const CFG_KEY = "flight2cal_config";

function loadConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || "{}");
    if (c.clientId) els.clientId.value = c.clientId;
    if (c.geminiKey) els.geminiKey.value = c.geminiKey;
    if (c.gmailQuery) els.gmailQuery.value = c.gmailQuery;
    if (c.maxResults) els.maxResults.value = c.maxResults;
  } catch {}
}

function saveConfig() {
  const c = {
    clientId: els.clientId.value.trim(),
    geminiKey: els.geminiKey.value.trim(),
    gmailQuery: els.gmailQuery.value.trim(),
    maxResults: els.maxResults.value,
  };
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
  log("✅ 配置已保存到本浏览器。");
}

// ---------- 日志 ----------
function log(msg) {
  const time = new Date().toLocaleTimeString();
  els.log.textContent += `[${time}] ${msg}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

// ---------- OAuth ----------
function connect() {
  const clientId = els.clientId.value.trim();
  if (!clientId) {
    alert("请先填写 Google OAuth 客户端 ID（见 README）。");
    return;
  }
  if (typeof google === "undefined" || !google.accounts) {
    alert("Google 库还没加载完，请稍等几秒再点。");
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) {
        log("❌ 授权失败: " + resp.error);
        return;
      }
      accessToken = resp.access_token;
      els.authStatus.textContent = "已连接 ✓";
      els.authStatus.classList.add("ok");
      els.scanBtn.disabled = false;
      log("✅ Google 账号已连接。");
    },
  });
  tokenClient.requestAccessToken({ prompt: "consent" });
}

// ---------- Gmail ----------
async function gmailFetch(path) {
  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!resp.ok) throw new Error("Gmail API " + resp.status + ": " + (await resp.text()));
  return resp.json();
}

async function scan() {
  els.scanBtn.disabled = true;
  els.results.innerHTML = "";
  els.resultsSection.classList.remove("hidden");

  try {
    const query = els.gmailQuery.value.trim();
    const max = Math.min(parseInt(els.maxResults.value, 10) || 20, 100);
    log(`🔎 搜索 Gmail：${query}`);

    const list = await gmailFetch(
      `/messages?q=${encodeURIComponent(query)}&maxResults=${max}`
    );
    const messages = list.messages || [];
    log(`找到 ${messages.length} 封候选邮件，开始解析…`);

    const geminiKey = els.geminiKey.value.trim();
    let allFlights = [];

    for (let i = 0; i < messages.length; i++) {
      const full = await gmailFetch(`/messages/${messages[i].id}?format=full`);
      const subject = headerOf(full, "Subject");
      const text = extractText(full.payload);
      if (!text.trim()) continue;

      let flights = [];
      try {
        flights = geminiKey
          ? await parseWithGemini(subject + "\n" + text, geminiKey)
          : parseHeuristic(subject + "\n" + text);
      } catch (e) {
        log(`⚠️ 第 ${i + 1} 封解析出错：${e.message}`);
        continue;
      }

      if (flights.length) {
        log(`📨 「${subject}」→ ${flights.length} 个航班`);
        allFlights.push(...flights);
      }
    }

    if (!allFlights.length) {
      els.results.innerHTML =
        '<p style="color:var(--muted)">没解析到航班。试试放宽 Gmail 搜索条件，或填入 Gemini Key 提高准确度。</p>';
    } else {
      allFlights.forEach((f, idx) => renderFlight(f, idx));
      log(`✅ 共解析出 ${allFlights.length} 个航班，请核对后添加。`);
    }
  } catch (e) {
    log("❌ 扫描失败：" + e.message);
  } finally {
    els.scanBtn.disabled = false;
  }
}

function headerOf(msg, name) {
  const h = (msg.payload?.headers || []).find(
    (x) => x.name.toLowerCase() === name.toLowerCase()
  );
  return h ? h.value : "";
}

// 递归提取邮件正文文本（优先 text/plain，其次把 html 标签去掉）
function extractText(payload) {
  if (!payload) return "";
  let out = "";
  const walk = (part) => {
    if (!part) return;
    if (part.parts) {
      part.parts.forEach(walk);
      return;
    }
    const data = part.body?.data;
    if (!data) return;
    const decoded = b64urlDecode(data);
    if (part.mimeType === "text/plain") out += decoded + "\n";
    else if (part.mimeType === "text/html") out += stripHtml(decoded) + "\n";
  };
  walk(payload);
  if (!out && payload.body?.data) out = b64urlDecode(payload.body.data);
  return out;
}

function b64urlDecode(data) {
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body ? doc.body.textContent.replace(/\n{3,}/g, "\n\n") : "";
}

// ---------- 渲染可编辑的航班卡片 ----------
function renderFlight(f, idx) {
  const div = document.createElement("div");
  div.className = "flight";
  div.dataset.idx = idx;
  div.innerHTML = `
    <div class="flight-grid">
      ${field("航空公司", "airline", f.airline)}
      ${field("航班号", "flightNumber", f.flightNumber)}
      ${field("出发地", "origin", f.origin)}
      ${field("目的地", "destination", f.destination)}
      ${field("出发日期", "departDate", f.departDate, "date")}
      ${field("出发时间", "departTime", f.departTime, "time")}
      ${field("到达日期", "arriveDate", f.arriveDate, "date")}
      ${field("到达时间", "arriveTime", f.arriveTime, "time")}
      ${field("订座号/票号", "confirmation", f.confirmation)}
    </div>
    <div class="flight-actions">
      <button class="btn-primary btn-small add-btn">添加到日历</button>
      <span class="flight-state"></span>
    </div>
    <details class="flight-source">
      <summary>原始邮件片段</summary>
      <pre>${escapeHtml(f.raw)}</pre>
    </details>
  `;
  div.querySelector(".add-btn").addEventListener("click", () =>
    addOne(div, div.querySelector(".flight-state"))
  );
  els.results.appendChild(div);
}

function field(label, key, value, type = "text") {
  const t = type === "date" ? "date" : type === "time" ? "time" : "text";
  return `<label>${label}<input data-key="${key}" type="${t}" value="${escapeHtml(value || "")}" /></label>`;
}

function readFlight(div) {
  const f = {};
  div.querySelectorAll("input[data-key]").forEach((inp) => (f[inp.dataset.key] = inp.value.trim()));
  return f;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---------- 写入 Google 日历 ----------
async function addOne(div, stateEl) {
  const f = readFlight(div);
  if (!f.departDate || !f.departTime) {
    stateEl.textContent = "⚠️ 需要出发日期和时间";
    return;
  }
  stateEl.textContent = "添加中…";

  const startISO = `${f.departDate}T${f.departTime}:00`;
  const endDate = f.arriveDate || f.departDate;
  const endTime = f.arriveTime || addHours(f.departTime, 2);
  const endISO = `${endDate}T${endTime}:00`;

  const summary = `✈️ ${f.flightNumber || "航班"} ${f.origin || ""}→${f.destination || ""}`.trim();
  const event = {
    summary,
    description:
      [
        f.airline && `航空公司：${f.airline}`,
        f.flightNumber && `航班号：${f.flightNumber}`,
        f.confirmation && `订座号/票号：${f.confirmation}`,
        "—— 由 机票→日历 自动生成",
      ]
        .filter(Boolean)
        .join("\n"),
    location: `${f.origin || ""} → ${f.destination || ""}`,
    start: { dateTime: startISO },
    end: { dateTime: endISO },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 180 }] },
  };

  try {
    const resp = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );
    if (!resp.ok) throw new Error(resp.status + ": " + (await resp.text()));
    const created = await resp.json();
    stateEl.textContent = "已添加 ✓";
    stateEl.classList.add("added");
    div.querySelector(".add-btn").disabled = true;
    log(`📅 已添加：${summary}（${created.htmlLink || ""}）`);
  } catch (e) {
    stateEl.textContent = "❌ 失败";
    log("添加日历失败：" + e.message);
  }
}

async function addAll() {
  const cards = [...els.results.querySelectorAll(".flight")];
  for (const div of cards) {
    const btn = div.querySelector(".add-btn");
    if (!btn.disabled) await addOne(div, div.querySelector(".flight-state"));
  }
}

function addHours(hhmm, hours) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  d.setHours(d.getHours() + hours);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---------- 绑定事件 ----------
els.saveConfig.addEventListener("click", saveConfig);
els.connectBtn.addEventListener("click", connect);
els.scanBtn.addEventListener("click", scan);
els.addAllBtn.addEventListener("click", addAll);
loadConfig();
