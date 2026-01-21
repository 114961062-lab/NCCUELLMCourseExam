// ==========================================
// logic.js - 核心邏輯
// ==========================================
import { state, CONSTANTS } from './store.js';
import { toNum, newUUID } from './utils.js';

// Re-export for convenience
export { getAllTakenCoursesForExam, computeJudgeEligibility, computeLawyerEligibility } from './exam.js';

const STATUS_DONE = "done";
const STATUS_PLANNED = "planned";

export function normalizeStatus(v) { return v === STATUS_PLANNED ? STATUS_PLANNED : STATUS_DONE; }
export function statusLabel(v) { return v === STATUS_PLANNED ? "預計" : "已修"; }
export function statusRank(v) { return v === STATUS_PLANNED ? 1 : 0; }

// logic.js 的最下方補上：

export function termKeyOfRow(r) {
    if (!r) return "";
    const t = String(r.term || "").trim();
    if (/^\d{3}[12]$/.test(t)) return t;
    if (r.isSmr === true || /暑修/.test(String(r.name || ""))) {
        const y = (t.match(/^(\d{3})/) || [])[1] || (String(r.name || "").match(/^(\d{3})/) || [])[1];
        return y ? `${y}S` : "";
    }
    const m = String(r.name || "").match(/^(\d{3})-(\d)\s+/);
    return m ? `${m[1]}${m[2]}` : "";
}

export function termOrder(termKey) {
    const k = String(termKey || "").trim();
    const m = k.match(/^(\d{3})([12]|S)$/);
    if (!m) return 1e9;
    const y = parseInt(m[1], 10);
    const w = m[2] === "S" ? 0 : m[2] === "1" ? 1 : 2;
    return y * 10 + w;
}

export function inferStatusByTermKey(termKey) {
    const k = String(termKey || "").trim();
    const m = k.match(/^(\d{3})([12]|S)$/);
    if (!m) return STATUS_DONE;
    const y = parseInt(m[1], 10);
    const baseYear = 1911 + y;
    let cutoff;
    if (m[2] === "2") cutoff = new Date(baseYear + 1, 4, 1);
    else cutoff = new Date(baseYear, 10, 1);
    return new Date().getTime() >= cutoff.getTime() ? STATUS_DONE : STATUS_PLANNED;
}

// State Mutation Helpers
export function removeCourseById(id) {
    if (!id) return;
    state.courses = (state.courses || []).filter(r => r.id !== id);
}

export function clearTrack(track) {
    state.courses = (state.courses || []).filter(r => r.track !== track);
}

export function enforceAutoStatusAll() {
    let changed = false;
    [...state.base, ...state.adv].forEach(r => {
        if (r.isTransfer) { if (normalizeStatus(r.status) !== STATUS_DONE) { r.status = STATUS_DONE; changed = true; } return; }
        const tk = termKeyOfRow(r);
        if (!tk) return;
        const next = inferStatusByTermKey(tk);
        if (normalizeStatus(r.status) !== next) { r.status = next; changed = true; }
        if (next === STATUS_PLANNED && r.grade) { r.grade = ""; changed = true; }
    });
    return changed;
}

export function ensureStatusConsistency() {
    // Simplified consistency check
    let changed = false;
    let earliestPlanned = 1e9;
    [...state.base, ...state.adv].forEach(r => {
        if (normalizeStatus(r.status) === STATUS_PLANNED) {
            const ord = termOrder(termKeyOfRow(r));
            if (ord < earliestPlanned) earliestPlanned = ord;
        }
    });
    [...state.base, ...state.adv].forEach(r => {
        const ord = termOrder(termKeyOfRow(r));
        if (ord > earliestPlanned && normalizeStatus(r.status) !== STATUS_PLANNED) {
            r.status = STATUS_PLANNED; r.grade = ""; changed = true;
        }
    });
    return changed;
}

// Credit Calculations
export function baseCreditSum() { return (state.base || []).reduce((s, r) => s + toNum(r.credit), 0); }
export function advCreditSum() { return (state.adv || []).reduce((s, r) => s + toNum(r.credit), 0); }
export function externalCreditSum() { return (state.adv || []).filter(r => r.source === 'external').reduce((s, r) => s + toNum(r.credit), 0); }
export function langCreditSum() { return [...state.base, ...state.adv].filter(r => r.isLang).reduce((s, r) => s + toNum(r.credit), 0); }

export function baseCreditSplit() {
    const rows = state.base || [];
    const internal = rows.filter(r => !r.isTransfer).reduce((s, r) => s + toNum(r.credit), 0);
    const transfer = rows.filter(r => !!r.isTransfer).reduce((s, r) => s + toNum(r.credit), 0);
    return { internal, transfer, total: internal + transfer };
}

export function calcCreditsForSummary() {
    let llmAdv=0, techNonLang=0, lawNonLang=0, externalNonLang=0, langTotal=0, transferAdv=0;
    for (const r of state.adv || []) {
        const c = toNum(r.credit);
        if (r.source === "transfer" || r.program === "抵免") { transferAdv += c; continue; }
        if (r.program === "法碩專班") { llmAdv += c; continue; }
        if (r.isLang) { langTotal += c; continue; }
        if (r.program === "法科所") techNonLang += c;
        else if (r.program === "法律系碩士班") lawNonLang += c;
        else if (r.source === "external" || r.program === "外院") externalNonLang += c;
    }
    return { llmAdv, techNonLang, lawNonLang, langTotal, externalNonLang, transferAdv, grandTotal: llmAdv+techNonLang+lawNonLang+langTotal+externalNonLang+transferAdv };
}

export function getAverageStats() {
    const mode = state.avgMode || "term";
    const termPick = state.avgTerm;
    const rows = [...state.base, ...state.adv].filter(r => !r.isTransfer);
    const filtered = rows.filter(r => {
        if (mode === "overall") return true;
        if (r.isSmr || /暑修/.test(r.name)) return false;
        return termKeyOfRow(r) === termPick;
    });
    let sumC=0, sumWG=0, count=0;
    for (const r of filtered) {
        if (normalizeStatus(r.status) === STATUS_PLANNED) continue;
        const g = Number(r.grade);
        const c = toNum(r.credit);
        if (Number.isFinite(g) && g >= 0 && c > 0) { sumC += c; sumWG += g * c; count++; }
    }
    return { avg: sumC ? sumWG/sumC : null, sumC, count };
}

export let currentCapWarnMsg = "";
export function guardCrossCaps(extraRow) {
    const rows = [...state.adv, extraRow].filter(Boolean);
    const ext = rows.filter(r => r.source === 'external' || r.program === '外院').reduce((s, r) => s + toNum(r.credit), 0);
    const lang = rows.filter(r => r.isLang).reduce((s, r) => s + toNum(r.credit), 0);
    const warns = [];
    if (ext > CONSTANTS.CAP_EXTERNAL) warns.push(`外院學分已達 ${ext} (上限 ${CONSTANTS.CAP_EXTERNAL})`);
    if (lang > CONSTANTS.CAP_LANG) warns.push(`語文學分已達 ${lang} (上限 ${CONSTANTS.CAP_LANG})`);
    currentCapWarnMsg = warns.join("；");
    return true;
}

export function mergeLegacyListsIntoCourses() {
    if (state.courses && state.courses.length) return;
    const merged = [];
    (state.base||[]).forEach(r => merged.push({...r, track:'base'}));
    (state.adv||[]).forEach(r => merged.push({...r, track:'adv'}));
    state.courses = merged;
}

export function rebuildViews() {
    const c = state.courses || [];
    state.base = c.filter(r => r.track === 'base');
    state.adv = c.filter(r => r.track === 'adv');
}

