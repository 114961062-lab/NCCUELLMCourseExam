// ==========================================
// logic.js - 業務邏輯 (計算、檢核、狀態維護)
// ==========================================
import { state, CONSTANTS } from './store.js';
import { toNum, termToLabel, yearOfCourse, termOfCourse } from './utils.js';

// --- Status & Term Helpers ---

export const STATUS_DONE = "done";
export const STATUS_PLANNED = "planned";

export function normalizeStatus(v) {
  return v === STATUS_PLANNED ? STATUS_PLANNED : STATUS_DONE;
}

export function statusLabel(v) {
  return v === STATUS_PLANNED ? "預計" : "已修";
}

export function statusRank(v) {
  return v === STATUS_PLANNED ? 1 : 0; // 已修優先
}

// 取得該列資料對應的 "Term Key" (如 "1141", "114S")
export function termKeyOfRow(r) {
  if (!r) return "";
  const t = String(r.term || "").trim();
  if (/^\d{3}[12]$/.test(t)) return t;

  // 暑修：優先用 isSmr；其次用名稱含「暑修」
  const isSummer = r.isSmr === true || /暑修/.test(String(r.name || ""));
  if (isSummer) {
    const y = (t.match(/^(\d{3})/) || [])[1] || (String(r.name || "").match(/^(\d{3})/) || [])[1] || "";
    return y ? `${y}S` : "";
  }
  
  // 從名稱解析 (如 114-1 xxx)
  const m = String(r.name || "").match(/^(\d{3})-(\d)\s+/);
  if (m) return `${m[1]}${m[2]}`;
  
  return "";
}

export function termOrder(termKey) {
  const k = String(termKey || "").trim();
  const m = k.match(/^(\d{3})([12]|S)$/);
  if (!m) return 1e9;
  const y = parseInt(m[1], 10);
  const sem = m[2];
  // 排序：暑修(S) < 上學期(1) < 下學期(2)
  const w = sem === "S" ? 0 : sem === "1" ? 1 : 2; 
  return y * 10 + w;
}

// 依現在時間自動判斷狀態
export function inferStatusByTermKey(termKey) {
  const k = String(termKey || "").trim();
  const m = k.match(/^(\d{3})([12]|S)$/);
  if (!m) return STATUS_DONE; 

  const y = parseInt(m[1], 10);
  const sem = m[2];
  const baseYear = 1911 + y;

  let cutoff;
  if (sem === "2") {
    cutoff = new Date(baseYear + 1, 4, 1, 0, 0, 0, 0); // 隔年 5/1
  } else {
    cutoff = new Date(baseYear, 10, 1, 0, 0, 0, 0); // 當年 11/1
  }

  const now = new Date();
  return now.getTime() >= cutoff.getTime() ? STATUS_DONE : STATUS_PLANNED;
}

// --- List Management & Consistency ---

// 將 legacy 的 base/adv 陣列合併回 canonical `state.courses`
export function mergeLegacyListsIntoCourses() {
  if (Array.isArray(state.courses) && state.courses.length) return;
  const merged = [];
  const base = Array.isArray(state.base) ? state.base : [];
  const adv  = Array.isArray(state.adv)  ? state.adv  : [];
  for (const r of base) {
    if (r && typeof r === 'object') merged.push({ ...r, track: r.track || 'base', source: r.source || 'internal' });
  }
  for (const r of adv) {
    if (r && typeof r === 'object') merged.push({ ...r, track: r.track || 'adv', source: r.source || 'internal' });
  }
  state.courses = merged;
}

// 從 `state.courses` 重建 `state.base` 和 `state.adv` 視圖
export function rebuildViews() {
  const courses = Array.isArray(state.courses) ? state.courses : (state.courses = []);
  for (const r of courses) {
    if (!r || typeof r !== 'object') continue;
    if (!r.track) {
      if (r.level === 'base') r.track = 'base';
      else if (r.source === 'transfer' && !r.dept) r.track = 'base';
      else if (r.source === 'transfer' && r.dept) r.track = 'adv';
      else if (r.dept || r.program) r.track = 'adv';
      else r.track = 'base';
    }
    // 抵免一律已修
    if (r.source === 'transfer') r.status = STATUS_DONE;
  }
  state.base = courses.filter(r => r && r.track === 'base');
  state.adv  = courses.filter(r => r && r.track === 'adv');
}

export function removeCourseById(id) {
  if (!id) return;
  state.courses = (state.courses || []).filter(r => r && r.id !== id);
}

export function clearTrack(track) {
  state.courses = (state.courses || []).filter(r => r && r.track !== track);
}

// 確保狀態一致性 (時間序、同學期一致)
export function ensureStatusConsistency() {
  let changed = false;

  const forEachStudyRow = (fn) => {
    [state.base, state.adv].forEach(arr => {
      (arr || []).forEach(fn);
    });
  };

  // 1. Normalize
  forEachStudyRow(r => {
    const prev = r.status;
    r.status = normalizeStatus(r.status);
    if (prev !== r.status) changed = true;
    if (r.status === STATUS_PLANNED && String(r.grade || "").trim() !== "") {
      r.grade = "";
      changed = true;
    }
  });

  // 2. 找出最早的 "Planned"，其後所有學期強制 Planned
  let earliest = 1e9;
  forEachStudyRow(r => {
    const tk = termKeyOfRow(r);
    if (!tk) return;
    if (normalizeStatus(r.status) === STATUS_PLANNED) {
      earliest = Math.min(earliest, termOrder(tk));
    }
  });

  if (earliest < 1e9) {
    forEachStudyRow(r => {
      const tk = termKeyOfRow(r);
      if (!tk) return;
      if (termOrder(tk) >= earliest) {
        if (normalizeStatus(r.status) !== STATUS_PLANNED) {
          r.status = STATUS_PLANNED;
          r.grade = "";
          changed = true;
        }
      }
    });
  }

  // 3. 同學期一致性
  const termHasPlanned = new Set();
  forEachStudyRow(r => {
    const tk = termKeyOfRow(r);
    if (tk && normalizeStatus(r.status) === STATUS_PLANNED) termHasPlanned.add(tk);
  });
  
  for (const tk of termHasPlanned) {
    forEachStudyRow(r => {
      if (termKeyOfRow(r) === tk && normalizeStatus(r.status) !== STATUS_PLANNED) {
        r.status = STATUS_PLANNED;
        r.grade = "";
        changed = true;
      }
    });
  }

  return changed;
}

export function enforceAutoStatusAll() {
  let changed = false;
  const process = (list) => {
    (list || []).forEach(r => {
        if(r.isTransfer) {
            if(normalizeStatus(r.status) !== STATUS_DONE) { r.status = STATUS_DONE; changed=true; }
            return;
        }
        const tk = termKeyOfRow(r);
        if(!tk) return;
        const next = inferStatusByTermKey(tk);
        if(normalizeStatus(r.status) !== next) {
            r.status = next;
            changed = true;
        }
    });
  };
  process(state.base);
  process(state.adv);
  return changed;
}

// --- Credit Calculations ---

export function baseCreditSum() {
  return (state.base || []).reduce((s, r) => s + toNum(r.credit), 0);
}

export function baseCreditSplit() {
  const rows = (state.base || []);
  const internal = rows.filter(r => !r.isTransfer).reduce((s, r) => s + toNum(r.credit), 0);
  const transfer = rows.filter(r => !!r.isTransfer).reduce((s, r) => s + toNum(r.credit), 0);
  return { internal, transfer, total: internal + transfer };
}

export function advCreditSum() {
  return (state.adv || []).reduce((s, r) => s + toNum(r.credit), 0);
}

export function externalCreditSum() {
  return (state.adv || []).filter((r) => r.source === "external").reduce((s, r) => s + toNum(r.credit), 0);
}

export function langCreditSum() {
    const rows = [...(state.base || []), ...(state.adv || [])];
    return rows.filter((r) => r.isLang === true).reduce((s, r) => s + toNum(r.credit), 0);
}

export function isCrossProgramByProgramName(p) {
    return p === "法律系碩士班" || p === "法科所";
}

// 計算跨系所學分 (包含外院、語文、他所)
export function calcCrossCredits(extraRow) {
  const rows = [...(state.adv || [])];
  if (extraRow) rows.push(extraRow);

  const crossInternal = rows
    .filter((r) => r.source === "internal" && isCrossProgramByProgramName(r.program))
    .reduce((s, r) => s + toNum(r.credit), 0);

  const external = rows.filter((r) => r.source === "external").reduce((s, r) => s + toNum(r.credit), 0);

  const lang = rows
    .filter((r) => r.isLang === true && (r.source === "external" || (r.source === "internal" && isCrossProgramByProgramName(r.program))))
    .reduce((s, r) => s + toNum(r.credit), 0);

  const total = crossInternal + external;
  return { crossInternal, external, lang, total, remaining: CONSTANTS.CAP_CROSS_TOTAL - total };
}

export let currentCapWarnMsg = "";

export function guardCrossCaps(extraRow) {
  const { total, external, lang } = calcCrossCredits(extraRow);
  const warns = [];
  if (external > CONSTANTS.CAP_EXTERNAL) warns.push(`外院學分已達 ${external}（可認列上限 ${CONSTANTS.CAP_EXTERNAL}）`);
  if (lang > CONSTANTS.CAP_LANG) warns.push(`語文學分已達 ${lang}（可認列上限 ${CONSTANTS.CAP_LANG}）`);
  if (total > CONSTANTS.CAP_CROSS_TOTAL) warns.push(`跨系所合計已達 ${total}（可認列上限 ${CONSTANTS.CAP_CROSS_TOTAL}）`);

  currentCapWarnMsg = warns.length ? `⚠️ 超出可認列上限提醒：${warns.join("；")}（仍可加入課程清單）` : "";
  return true; 
}

export function calcCreditsForSummary() {
  let llmAdv = 0;
  let techNonLang = 0;
  let lawNonLang = 0;
  let externalNonLang = 0;
  let langTotal = 0;
  let transferAdv = 0;

  for (const r of state.adv || []) {
    const c = toNum(r.credit);
    if (r.source === "transfer" || r.program === "抵免") {
      transferAdv += c;
      continue;
    }
    if (r.program === "法碩專班") {
      llmAdv += c;
      continue;
    }
    if (r.isLang === true) {
      langTotal += c;
      continue;
    }
    if (r.program === "法科所") techNonLang += c;
    else if (r.program === "法律系碩士班") lawNonLang += c;
    else if (r.source === "external" || r.program === "外院") externalNonLang += c;
  }
  
  const grandTotal = llmAdv + techNonLang + lawNonLang + externalNonLang + langTotal + transferAdv;
  return { llmAdv, techNonLang, lawNonLang, langTotal, externalNonLang, transferAdv, grandTotal };
}

// 平均分數計算
function __isSummerRow(r) {
    if (r?.isSmr === true) return true;
    return /暑修/.test(String(r?.name || ""));
}

function __termFromRow(r) {
    if (r && r.term && /^\d{3}[12]$/.test(String(r.term))) return String(r.term);
    const m = String(r?.name || "").match(/^(\d{3})-(\d)\s+/);
    if (m) return `${m[1]}${m[2]}`;
    return "";
}

export function getAverageStats() {
    const mode = String(state.avgMode || "term");
    const termPick = String(state.avgTerm || "").trim();
  
    const rows = [];
