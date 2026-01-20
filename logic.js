// ==========================================
// logic.js - 業務邏輯 (修復版)
// ==========================================
import { state, CONSTANTS } from './store.js';
import { toNum, termToLabel } from './utils.js';

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
  return v === STATUS_PLANNED ? 1 : 0;
}

export function termKeyOfRow(r) {
  if (!r) return "";
  const t = String(r.term || "").trim();
  if (/^\d{3}[12]$/.test(t)) return t;
  const isSummer = r.isSmr === true || /暑修/.test(String(r.name || ""));
  if (isSummer) {
    const y = (t.match(/^(\d{3})/) || [])[1] || (String(r.name || "").match(/^(\d{3})/) || [])[1] || "";
    return y ? `${y}S` : "";
  }
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
  const w = sem === "S" ? 0 : sem === "1" ? 1 : 2; 
  return y * 10 + w;
}

export function inferStatusByTermKey(termKey) {
  const k = String(termKey || "").trim();
  const m = k.match(/^(\d{3})([12]|S)$/);
  if (!m) return STATUS_DONE; 
  const y = parseInt(m[1], 10);
  const sem = m[2];
  const baseYear = 1911 + y;
  let cutoff;
  if (sem === "2") {
    cutoff = new Date(baseYear + 1, 4, 1, 0, 0, 0, 0); 
  } else {
    cutoff = new Date(baseYear, 10, 1, 0, 0, 0, 0); 
  }
  const now = new Date();
  return now.getTime() >= cutoff.getTime() ? STATUS_DONE : STATUS_PLANNED;
}

// --- List Management ---

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

export function ensureStatusConsistency() {
  let changed = false;
  const forEachStudyRow = (fn) => {
    [state.base, state.adv].forEach(arr => { (arr || []).forEach(fn); });
  };
  forEachStudyRow(r => {
    const prev = r.status;
    r.status = normalizeStatus(r.status);
    if (prev !== r.status) changed = true;
    if (r.status === STATUS_PLANNED && String(r.grade || "").trim() !== "") {
      r.grade = ""; changed = true;
    }
  });
  let earliest = 1e9;
  forEachStudyRow(r => {
    const tk = termKeyOfRow(r);
    if (!tk) return;
    if (normalizeStatus(r.status) === STATUS_PLANNED) earliest = Math.min(earliest, termOrder(tk));
  });
  if (earliest < 1e9) {
    forEachStudyRow(r => {
      const tk = termKeyOfRow(r);
      if (!tk) return;
      if (termOrder(tk) >= earliest) {
        if (normalizeStatus(r.status) !== STATUS_PLANNED) { r.status = STATUS_PLANNED; r.grade = ""; changed = true; }
      }
    });
  }
  const termHasPlanned = new Set();
  forEachStudyRow(r => {
    const tk = termKeyOfRow(r);
    if (tk && normalizeStatus(r.status) === STATUS_PLANNED) termHasPlanned.add(tk);
  });
  for (const tk of termHasPlanned) {
    forEachStudyRow(r => {
      if (termKeyOfRow(r) === tk && normalizeStatus(r.status) !== STATUS_PLANNED) {
        r.status = STATUS_PLANNED; r.grade = ""; changed = true;
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
        if(normalizeStatus(r.status) !== next) { r.status = next; changed = true; }
    });
  };
  process(state.base);
  process(state.adv);
  return changed;
}

// --- Credits ---

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

export function calcCrossCredits(extraRow) {
  const rows = [...(state.adv || [])];
  if (extraRow) rows.push(extraRow);
  const crossInternal = rows.filter((r) => r.source === "internal" && isCrossProgramByProgramName(r.program)).reduce((s, r) => s + toNum(r.credit), 0);
  const external = rows.filter((r) => r.source === "external").reduce((s, r) => s + toNum(r.credit), 0);
  const lang = rows.filter((r) => r.isLang === true && (r.source === "external" || (r.source === "internal" && isCrossProgramByProgramName(r.program)))).reduce((s, r) => s + toNum(r.credit), 0);
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
  let llmAdv = 0; let techNonLang = 0; let lawNonLang = 0; let externalNonLang = 0; let langTotal = 0; let transferAdv = 0;
  for (const r of state.adv || []) {
    const c = toNum(r.credit);
    if (r.source === "transfer" || r.program === "抵免") { transferAdv += c; continue; }
    if (r.program === "法碩專班") { llmAdv += c; continue; }
    if (r.isLang === true) { langTotal += c; continue; }
    if (r.program === "法科所") techNonLang += c;
    else if (r.program === "法律系碩士班") lawNonLang += c;
    else if (r.source === "external" || r.program === "外院") externalNonLang += c;
  }
  const grandTotal = llmAdv + techNonLang + lawNonLang + externalNonLang + langTotal + transferAdv;
  return { llmAdv, techNonLang, lawNonLang, langTotal, externalNonLang, transferAdv, grandTotal };
}

function __isSummerRow(r) { return r?.isSmr === true || /暑修/.test(String(r?.name || "")); }
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
    for (const r of state.base || []) { if (!r?.isTransfer) rows.push(r); }
    for (const r of state.adv || [])  { if (!r?.isTransfer) rows.push(r); }
    const filtered = rows.filter((r) => {
      if (mode === "overall") return true;
      if (__isSummerRow(r)) return false; 
      const t = __termFromRow(r);
      return t && t === termPick;
    });
    let sumC = 0; let sumWG = 0; let count = 0;
    for (const r of filtered) {
        if (normalizeStatus(r?.status) === STATUS_PLANNED) continue;
        const c = toNum(r.credit);
        const gradeRaw = String(r.grade ?? "").trim();
        if (gradeRaw === "") continue; 
        const g = Number(gradeRaw);
        if (!Number.isFinite(g) || g < 0 || g > 100 || c <= 0) continue;
        sumC += c; sumWG += g * c; count += 1;
    }
    const avg = sumC > 0 ? sumWG / sumC : null;
    return { avg, sumC, count };
}

// --- Exam Logic ---

function normCourseName(row) {
    let s = String(row?.name || "").trim();
    s = s.replace(/^\d{3}-\d\s+/, "").replace(/\(語文課\)/g, "").replace(/\s+/g, " ").trim();
    return s;
}
function sourceRankForExam(course) {
    const raw = course?.raw || {};
    if (raw.source === "creditClass") return 3;
    if (raw.isTransfer) return 2;
    return 1;
}
function isCountedForExamEligibility(row) {
    if (!row) return false;
    if (row.isTransfer) return true;
    return normalizeStatus(row.status) !== STATUS_PLANNED;
}

export function getAllTakenCoursesForExam() {
    const internal = [...(state.base || []), ...(state.adv || [])]
      .filter((r) => isCountedForExamEligibility(r))
      .map((r) => ({
      name: normCourseName(r),
      credit: toNum(r.credit),
      raw: r,
      origin: r && r.source === "external" ? "外院（本系統）" : (r && r.program ? `本系統-${r.program}` : "本系統"),
    }));
    const external = (state.externalCredits || []).map((r) => ({
      name: String(r.name || "").trim(),
      credit: toNum(r.credit),
      raw: r,
      origin: r.source === "creditClass" ? `學分班-${r.school || "未填"}` : `學校學分-${r.school || "未填"}`,
    }));
    return [...internal, ...external].filter((r) => r.name && r.credit > 0);
}

function pickCountedByPriority(hits, cap = 3) {
    const sorted = [...hits].sort((a, b) => {
      const ra = sourceRankForExam(a);
      const rb = sourceRankForExam(b);
      if (rb !== ra) return rb - ra;
      return b.credit - a.credit;
    });
    const rawSum = sorted.reduce((s, h) => s + toNum(h.credit), 0);
    let counted = 0; const picked = [];
    for (const h of sorted) {
      if (counted >= cap) break;
      const c = toNum(h.credit);
      if (c <= 0) continue;
      picked.push(h);
      counted = Math.min(cap, counted + c);
    }
    return { rawSum, counted, picked, hitCount: sorted.length };
}

function civilSubareasHit(courseName) {
    const name = String(courseName || "").trim();
    const hits = new Set();
    if (/民法總則/.test(name)) hits.add("民法總則");
    if (/民法債編總論/.test(name)) hits.add("民法債編總論");
    if (/民法債編各論/.test(name)) hits.add("民法債編各論");
    if (/物權法/.test(name)) hits.add("民法物權");
    if (/身分法/.test(name)) hits.add("身分法");
    const isGenericCivil = /民法/.test(name) && !/(民法總則|民法債編總論|民法債編各論|物權法|身分法)/.test(name);
    if (isGenericCivil) hits.add("民法（整體）");
    return hits;
}

export function hasCivilQualified(courses) {
    const set = new Set();
    for (const c of courses) for (const h of civilSubareasHit(c.name)) set.add(h);
    const ok = set.has("民法（整體）") || set.size >= 3;
    return { ok, hits: Array.from(set) };
}

export function hasCriminalQualified(courses) {
    const hasGen = courses.some((c) => /刑法總則/.test(c.name));
    const hasSpe = courses.some((c) => /刑法分則/.test(c.name));
    const hasWhole = courses.some((c) => /(^|\s)刑法(\s|$)|刑法專題研究|基礎刑法|進階刑法/.test(c.name));
    if (hasWhole) return { ok: true, hasGen: true, hasSpe: true, hasWhole: true };
    return { ok: hasGen && hasSpe, hasGen, hasSpe, hasWhole: false };
}

export function computeJudgeEligibility(courses) {
    const subjects = [
      { key: "憲法", test: (n) => /憲法/.test(n) },
      { key: "行政法", test: (n) => /行政法/.test(n) || /行政救濟法/.test(n) },
      { key: "民事訴訟法", test: (n) => /民事訴訟法/.test(n) },
      { key: "刑事訴訟法", test: (n) => /刑事訴訟法/.test(n) },
      { key: "商事法", test: (n) => /商事法/.test(n) || /公司法|票據法|保險法|海商法|證券交易法/.test(n) },
      { key: "民法", special: "civil" },
      { key: "刑法", special: "criminal" },
    ];
    const civil = hasCivilQualified(courses);
    const crim = hasCriminalQualified(courses);
    const detail = []; let passCount = 0; let totalCountedCredits = 0;
    for (const s of subjects) {
      let ok = false; let used = []; let raw = 0; let counted = 0;
      if (s.special === "civil") {
        const hits = courses.filter(c => /(民法總則|民法債編總論|民法債編各論|物權法|身分法)/.test(c.name) || (/民法/.test(c.name) && !/(民法總則|民法債編總論|民法債編各論|物權法|身分法)/.test(c.name)));
        const pickedInfo = pickCountedByPriority(hits, 3);
        raw = pickedInfo.rawSum; ok = civil.ok; counted = ok ? pickedInfo.counted : 0;
        used = ok ? [`已涵蓋：${civil.hits.join("、")}`, ...pickedInfo.picked.map(h => `${h.name}（${h.credit}）`)] : [`已涵蓋：${civil.hits.length ? civil.hits.join("、") : "—"}`];
      } else if (s.special === "criminal") {
        const hits = courses.filter(c => /(刑法總則|刑法分則)/.test(c.name) || /(^|\s)刑法(\s|$)|刑法專題研究|基礎刑法|進階刑法/.test(c.name));
        const pickedInfo = pickCountedByPriority(hits, 3);
        raw = pickedInfo.rawSum; ok = crim.ok; counted = ok ? pickedInfo.counted : 0;
        used = [`刑法總則：${crim.hasGen?"✅":"❌"}；刑法分則：${crim.hasSpe?"✅":"❌"}`, ...pickedInfo.picked.map(h => `${h.name}（${h.credit}）`)];
      } else {
        const hits = courses.filter(c => s.test(c.name));
        const okHits = hits.filter(h => toNum(h.credit) >= 2);
        ok = okHits.length > 0;
        const pickedInfo = pickCountedByPriority(ok ? okHits : hits, 3);
        raw = pickedInfo.rawSum; counted = ok ? pickedInfo.counted : 0;
        used = pickedInfo.picked.map(h => `${h.name}（${h.credit}）`);
      }
      if (ok) passCount += 1;
      totalCountedCredits += counted;
      detail.push({ subject: s.key, ok, raw, counted, used });
    }
    return { pass: passCount >= 2, passCount, totalCountedCredits, detail };
}

export function computeLawyerEligibility(courses) {
    const civil = hasCivilQualified(courses);
    const crim = hasCriminalQualified(courses);
    const disciplines = [
        { key: "民事訴訟法", test: (n) => /民事訴訟法/.test(n) },
        { key: "商事法", test: (n) => /商事法/.test(n) },
        { key: "非訟事件法", test: (n) => /非訟事件法/.test(n) },
        { key: "仲裁法", test: (n) => /仲裁法/.test(n) },
        { key: "公證法", test: (n) => /公證法/.test(n) },
        { key: "強制執行法", test: (n) => /強制執行法/.test(n) },
        { key: "破產法", test: (n) => /破產法/.test(n) },
        { key: "國際私法", test: (n) => /國際私法/.test(n) },
        { key: "少年事件處理法", test: (n) => /少年事件處理法/.test(n) },
        { key: "刑事訴訟法", test: (n) => /刑事訴訟法/.test(n) },
        { key: "證據法", test: (n) => /證據法/.test(n) },
        { key: "行政法", test: (n) => /行政法/.test(n) || /行政救濟法/.test(n) },
        { key: "公司法", test: (n) => /公司法/.test(n) },
        { key: "海商法", test: (n) => /海商法/.test(n) },
        { key: "票據法", test: (n) => /票據法/.test(n) },
        { key: "保險法", test: (n) => /保險法/.test(n) },
        { key: "證券交易法", test: (n) => /證券交易法/.test(n) },
        { key: "土地法", test: (n) => /土地法/.test(n) },
        { key: "租稅法", test: (n) => /租稅法/.test(n) },
        { key: "公平交易法", test: (n) => /公平交易法/.test(n) },
        { key: "智慧財產權法", test: (n) => /智慧財產權法/.test(n) },
        { key: "著作權法", test: (n) => /著作權法/.test(n) },
        { key: "專利法", test: (n) => /專利/.test(n) },
        { key: "商標法", test: (n) => /商標法/.test(n) },
        { key: "消費者保護法", test: (n) => /消費者保護法/.test(n) },
        { key: "社會福利法", test: (n) => /社會福利法/.test(n) || /社會保險法/.test(n) },
        { key: "勞動法", test: (n) => /勞動法/.test(n) || /勞工法/.test(n) },
        { key: "環境法", test: (n) => /環境法/.test(n) || /環境保護法/.test(n) },
        { key: "國際公法", test: (n) => /國際公法/.test(n) },
        { key: "國際貿易法", test: (n) => /國際貿易法/.test(n) || /國際貿易與法律/.test(n) },
        { key: "英美契約法", test: (n) => /英美契約法/.test(n) },
        { key: "英美侵權行為法", test: (n) => /英美侵權行為法/.test(n) },
        { key: "法理學", test: (n) => /法理學/.test(n) },
        { key: "法學方法論", test: (n) => /法學方法論/.test(n) },
    ];
    const perDetail = disciplines.map((d) => {
        const hits = courses.filter((c) => d.test(c.name));
        const pickedInfo = pickCountedByPriority(hits, 3);
        return { key: d.key, rawSum: pickedInfo.rawSum, counted: pickedInfo.counted, hitCount: hits.length, picked: pickedInfo.picked.map((h) => ({ name: h.name, credit: h.credit, origin: h.origin })), };
    });
    const civilHits = courses.filter(c => /(民法總則|民法債編總論|民法債編各論|物權法|身分法)/.test(c.name) || (/民法/.test(c.name) && !/(民法總則|民法債編總論|民法債編各論|物權法|身分法)/.test(c.name)));
    const civilPickedInfo = pickCountedByPriority(civilHits, 3);
    const civilCounted = civil.ok ? civilPickedInfo.counted : 0;
    const crimHits = courses.filter(c => /(刑法總則|刑法分則)/.test(c.name) || /(^|\s)刑法(\s|$)|刑法專題研究|基礎刑法|進階刑法/.test(c.name));
    const crimPickedInfo = pickCountedByPriority(crimHits, 3);
    const crimCounted = crim.ok ? crimPickedInfo.counted : 0;
    let disciplineCount = 0; let totalCountedCredits = 0;
    if (civil.ok) { disciplineCount++; totalCountedCredits += civilCounted; }
    if (crim.ok) { disciplineCount++; totalCountedCredits += crimCounted; }
    const ms = perDetail.find(x => x.key === "民事訴訟法") || {counted:0};
    const xs = perDetail.find(x => x.key === "刑事訴訟法") || {counted:0};
    for (const x of perDetail) {
        if (x.counted > 0) { disciplineCount++; totalCountedCredits += x.counted; }
    }
    const mustOk = civil.ok && crim.ok && (ms.counted > 0 || xs.counted > 0);
    const pass = disciplineCount >= 7 && totalCountedCredits >= 20 && mustOk;
    return { pass, disciplineCount, totalCountedCredits, mustOk, civil: { ok: civil.ok, hits: civil.hits, raw: civilPickedInfo.rawSum, counted: civilCounted, picked: civilPickedInfo.picked }, criminal: { ok: crim.ok, hasGen: crim.hasGen, hasSpe: crim.hasSpe, raw: crimPickedInfo.rawSum, counted: crimCounted, picked: crimPickedInfo.picked }, ms, xs, perDetail };
}
