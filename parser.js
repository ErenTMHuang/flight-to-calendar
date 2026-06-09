/*
 * parser.js — 从邮件纯文本中提取机票/航班信息。
 * 提供两条路径：
 *   1) parseWithGemini(text, apiKey)  —— 调用 Gemini，准确度高（推荐）
 *   2) parseHeuristic(text)           —— 纯正则规则，免 key 但不准（兜底）
 *
 * 两者都返回统一结构的航班数组：
 *   {
 *     airline, flightNumber,
 *     origin, destination,           // 机场名或 IATA 代码
 *     departDate, departTime,        // YYYY-MM-DD, HH:mm（当地时间）
 *     arriveDate, arriveTime,
 *     confirmation,                  // 订座号/票号（可空）
 *     raw                            // 原始片段，方便人工核对
 *   }
 */

const GEMINI_MODEL = "gemini-2.0-flash";

const FLIGHT_SCHEMA_PROMPT = `你是航班信息提取助手。从下面这封邮件的纯文本中，提取所有航班段。
只输出 JSON，不要任何解释、不要 markdown 代码块。格式为一个数组，每个航班对象包含字段：
- airline: 航空公司名称（如 "中国国航"、"Delta"），未知留空字符串
- flightNumber: 航班号（如 "CA1234"），未知留空
- origin: 出发机场（城市名、机场名或 IATA 三字码），未知留空
- destination: 到达机场，未知留空
- departDate: 出发日期，格式严格为 YYYY-MM-DD，未知留空
- departTime: 出发时间，格式严格为 HH:mm（24小时制，当地时间），未知留空
- arriveDate: 到达日期 YYYY-MM-DD，未知则与 departDate 相同
- arriveTime: 到达时间 HH:mm，未知留空
- confirmation: 订座号或电子票号，未知留空
如果邮件里没有任何航班，输出空数组 []。
邮件内容如下：
"""
`;

async function parseWithGemini(text, apiKey) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=` +
    encodeURIComponent(apiKey);

  const body = {
    contents: [{ parts: [{ text: FLIGHT_SCHEMA_PROMPT + text.slice(0, 12000) + '\n"""' }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error("Gemini 请求失败: " + resp.status + " " + (await resp.text()));
  }

  const data = await resp.json();
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    // 万一带了 markdown 包裹，剥一层再试
    const m = out.match(/\[[\s\S]*\]/);
    parsed = m ? JSON.parse(m[0]) : [];
  }
  return (Array.isArray(parsed) ? parsed : []).map((f) => normalizeFlight(f, text));
}

/* ---------- 兜底：纯正则启发式解析 ---------- */

function parseHeuristic(text) {
  const flights = [];
  // 航班号：两位航司代码 + 1~4 位数字，如 CA1234 / MU 587 / 3U8888
  const flightRe = /\b([A-Z0-9]{2})\s?(\d{2,4})\b/g;
  const timeRe = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
  const seen = new Set();

  let m;
  while ((m = flightRe.exec(text)) !== null) {
    const flightNumber = (m[1] + m[2]).toUpperCase();
    if (seen.has(flightNumber)) continue;
    // 过滤明显不是航班号的（比如纯年份附近）
    if (/^\d{2}$/.test(m[1])) continue;
    seen.add(flightNumber);

    // 取航班号附近 ±200 字的窗口，找日期/时间/机场
    const start = Math.max(0, m.index - 200);
    const window = text.slice(start, m.index + 200);

    const date = findDate(window);
    const times = [];
    let t;
    timeRe.lastIndex = 0;
    while ((t = timeRe.exec(window)) !== null) times.push(t[0]);

    // 机场：三字 IATA 码（出现在括号里或大写孤立词）
    const airports = (window.match(/\b[A-Z]{3}\b/g) || []).filter(
      (a) => !["AND", "THE", "FOR", "YOU", "USD", "CNY"].includes(a)
    );

    flights.push(
      normalizeFlight(
        {
          airline: "",
          flightNumber,
          origin: airports[0] || "",
          destination: airports[1] || "",
          departDate: date || "",
          departTime: times[0] || "",
          arriveDate: date || "",
          arriveTime: times[1] || "",
          confirmation: "",
        },
        window
      )
    );
  }
  return flights;
}

function findDate(s) {
  // 2025-06-08 / 2025/6/8 / 2025年6月8日
  let m = s.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  // 8 Jun 2025 / Jun 8, 2025
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  m = s.match(/(\d{1,2})\s*([A-Za-z]{3})[a-z]*\s*,?\s*(\d{4})/);
  if (m && months[m[2].toLowerCase()]) return `${m[3]}-${pad(months[m[2].toLowerCase()])}-${pad(m[1])}`;
  m = s.match(/([A-Za-z]{3})[a-z]*\s*(\d{1,2})\s*,?\s*(\d{4})/);
  if (m && months[m[1].toLowerCase()]) return `${m[3]}-${pad(months[m[1].toLowerCase()])}-${pad(m[2])}`;
  return "";
}

/* ---------- 公共工具 ---------- */

function normalizeFlight(f, raw) {
  return {
    airline: (f.airline || "").trim(),
    flightNumber: (f.flightNumber || "").trim(),
    origin: (f.origin || "").trim(),
    destination: (f.destination || "").trim(),
    departDate: (f.departDate || "").trim(),
    departTime: (f.departTime || "").trim(),
    arriveDate: (f.arriveDate || f.departDate || "").trim(),
    arriveTime: (f.arriveTime || "").trim(),
    confirmation: (f.confirmation || "").trim(),
    raw: (f.raw || raw || "").slice(0, 600),
  };
}

function pad(n) {
  return String(n).padStart(2, "0");
}
