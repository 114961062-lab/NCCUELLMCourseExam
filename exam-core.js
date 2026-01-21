// ==========================================
// exam-core.js - 司律考試共用核心與資料準備
// ==========================================
import { toNum } from './utils.js';
import { normalizeStatus } from './logic.js';
import { state } from './store.js';

// --- Data Helpers ---

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
    return normalizeStatus(row.status) !== "planned";
}

// 取得所有已修習課程（含外部、學分班）
export function getAllTakenCoursesForExam() {
    const internal = [...(state.base || []), ...(state.adv || [])]
        .filter(r => isCountedForExamEligibility(r))
        .map(r => ({
            name: normCourseName(r),
            credit: toNum(r.credit),
            raw: r,
            origin: r.source === "external" ? "外院（本系統）" : (r.program ? `本系統-${r.program}` : "本系統")
        }));

    const external = (state.externalCredits || []).map(r => ({
        name: String(r.name || "").trim(),
        credit: toNum(r.credit),
        raw: r,
        origin: r.source === "creditClass" ? `學分班-${r.school || "未填"}` : `學校學分-${r.school || "未填"}`
    }));

    return [...internal, ...external].filter(r => r.name && r.credit > 0);
}

// 優先採計邏輯（學分班 > 抵免 > 其他）
export function pickCountedByPriority(hits, cap = 3) {
    const sorted = [...hits].sort((a, b) => {
        const ra = sourceRankForExam(a);
        const rb = sourceRankForExam(b);
        if (rb !== ra) return rb - ra;
        return b.credit - a.credit;
    });
    const rawSum = sorted.reduce((s, h) => s + toNum(h.credit), 0);
    let counted = 0;
    const picked = [];
    for (const h of sorted) {
        if (counted >= cap) break;
        const c = toNum(h.credit);
        if (c <= 0) continue;
        picked.push(h);
        counted = Math.min(cap, counted + c);
    }
    return { rawSum, counted, picked, hitCount: sorted.length };
}

// --- Shared Validators (Civil / Criminal) ---

function civilSubareasHit(courseName) {
    const name = String(courseName || "").trim();
    const hits = new Set();
    if (/民法總則/.test(name)) hits.add("民法總則");
    if (/民法債編總論/.test(name)) hits.add("民法債編總論");
    if (/民法債編各論/.test(name)) hits.add("民法債編各論");
    if (/物權法/.test(name)) hits.add("民法物權");
    if (/身分法/.test(name)) hits.add("身分法");
    if (/民法/.test(name) && !/(民法總則|民法債編總論|民法債編各論|物權法|身分法)/.test(name)) hits.add("民法（整體）");
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
