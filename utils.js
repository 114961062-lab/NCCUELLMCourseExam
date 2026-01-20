// ==========================================
// utils.js - 通用工具函式
// ==========================================

// 簡易 HTML 跳脫
export const esc = (s) =>
  (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function pad2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  return String(x).padStart(2, "0");
}

export const newUUID = () => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return String(Date.now() + Math.random());
};

export function clampGradeValue(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return "";
  let n = Number(s);
  if (!Number.isFinite(n)) n = 0;
  n = Math.round(n);
  if (n < 0) n = 0;
  if (n > 100) n = 100;
  return String(n);
}

export function toBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "y" || s === "yes";
}

export function toSlots(v) {
  const s = String(v ?? "").trim();
  if (!s) return [];
  return s.split("|").map((x) => String(x).trim()).filter(Boolean);
}

// CSV 解析邏輯
export function csvUnquote(s) {
  if (s == null) return "";
  s = String(s);
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).replace(/""/g, '"');
  }
  return s;
}

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cur);
    cur = "";
  };
  const pushRow = () => {
    if (row.length === 1 && String(row[0] || "").trim() === "") {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      pushCell();
      continue;
    }
    if (ch === "\n") {
      pushCell();
      pushRow();
      continue;
    }
    cur += ch;
  }
  pushCell();
  pushRow();
  return rows;
}

// 字串清理與正規化
export function normalizeProgram(p) {
  const s = String(p ?? '').trim();
  if (!s) return '';
  if (s === '法碩專班' || s === '法科所' || s === '法律系碩士班' || s === '外院' || s === '抵免') return s;
  if (/法碩|法學院.*在職|碩士在職/.test(s)) return '法碩專班';
  if (/法科|科際/.test(s)) return '法科所';
  if (/(法律(學系)?|法律系).*碩士班/.test(s) || s === '碩士班') return '法律系碩士班';
  if (/外院|外系|跨院/.test(s)) return '外院';
  if (/抵免|免修/.test(s)) return '抵免';
  return s;
}

export function normalizeDriveUrl(url) {
  const u = String(url || "").trim();
  if (!u) return u;
  const m = u.match(/drive\.google\.com\/file\/d\/([^\/]+)/i);
  if (m && m[1]) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  const m2 = u.match(/[?&]id=([^&]+)/i);
  if (m2 && m2[1] && /drive\.google\.com/i.test(u)) return `https://drive.google.com/uc?export=download&id=${m2[1]}`;
  return u;
}

export function sanitizeAlnum9(s) {
  return String(s || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 9);
}

export function sanitizeDigits3(s) {
  return String(s || "").replace(/\D/g, "").slice(0, 3);
}

export function stripCsvQuotes(s) {
  s = String(s ?? "");
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).replace(/""/g, '"');
  return s;
}

// 課程 ID 與學期相關
export function termOfCourse(c) {
    const idStr = String(c?.id ?? "");
    const y = idStr.slice(0, 3);
    const sem = idStr.slice(3, 4);
    if (!y || !sem) return "";
    return `${y}${sem}`;
}
  
export function yearOfCourse(c) {
    const idStr = String(c?.id ?? "");
    return idStr.slice(0, 3); 
}
  
export function termToLabel(term) {
    const t = String(term || "").trim();
    if (/^\d{3}[12]$/.test(t)) return `${t.slice(0, 3)}-${t.slice(3, 4)}`;
    if (/^\d{3}S$/i.test(t)) return `${t.slice(0, 3)}暑修`;
    return t;
}

export function termLabelForCourse(c) {
  if (c?.isSmr === true) return `${yearOfCourse(c)}暑修`;
  return termToLabel(termOfCourse(c));
}
