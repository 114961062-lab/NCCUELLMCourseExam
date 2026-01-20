// ==========================================
// store.js - 狀態管理與資料獲取 (修正版)
// ==========================================
import { 
    parseCSV, csvUnquote, normalizeDriveUrl, toSlots, toBool, normalizeProgram, 
    newUUID, toNum, sanitizeDigits3, stripCsvQuotes 
} from './utils.js';

// --- Constants ---
export const ALL_COURSES_CSV_URL = "https://raw.githubusercontent.com/114961062-lab/NCCUELLMCourseExam/main/nccuellmcourse.csv";
export const EXTERNAL_DEPT_CSV_URL = "https://raw.githubusercontent.com/114961062-lab/NCCUELLMCourseExam/29a9b5e2e7557832ba6a8862809c00bbd87288a5/nccu_master_dept_nolaw.csv";
export const STORAGE_KEY = "nccu_law_checklist_print_v8_integrated";
export const GRAD_CREDITS = 54;
export const CAP_CROSS_TOTAL = 18;
export const CAP_EXTERNAL = 6;
export const CAP_LANG = 3;
export const STATUS_DONE = "done";
export const STATUS_PLANNED = "planned";

export const CREDIT_CLASS_SUBJECTS = [
    "民法", "刑法", "刑事訴訟法", "民事訴訟法", "商事法", 
    "行政法", "強制執行法", "智慧財產權法", "證券交易法", "勞動法"
];
export const CREDIT_CLASS_FIXED_CREDIT = 3;

export const Base_CLASS_SUBJECTS_114 = [
    "民法總則", "民法債編總論", "民法債編各論", "物權法", "刑法總則", 
    "刑法分則", "憲法", "行政法", "公司法", "民事訴訟法",
   "刑事訴訟法", "論文寫作專題研究", "法律倫理"
];

// 🔴 關鍵修正：將所有常數打包匯出，讓 logic.js 和 ui.js 可以使用 CONSTANTS.xxx
export const CONSTANTS = {
    ALL_COURSES_CSV_URL,
    EXTERNAL_DEPT_CSV_URL,
    STORAGE_KEY,
    GRAD_CREDITS,
    CAP_CROSS_TOTAL,
    CAP_EXTERNAL,
    CAP_LANG,
    STATUS_DONE,
    STATUS_PLANNED,
    CREDIT_CLASS_SUBJECTS,
    CREDIT_CLASS_FIXED_CREDIT
};

// --- Global Data ---
export let allCourses = [];
export let externalDeptMapByCode = new Map(); 
export let systemStatus = {
    coursesLoaded: false,
    coursesError: null
};

// --- Reactive State ---
export let state = initState();

export function initState() {
    return {
      studentName: "",
      studentId: "",
      note: "",
      eligibleExempt: false,
      externalCourseEnabled: false,
      eligibleType: "degree",
      eligibleDegree: "",
      eligibleCredential: "",
      creditTransferEligible: false,
      showExamAnalysis: false,
      courses: [], 
      base: [],
      adv: [],
      externalCredits: [],
      avgMode: "term",
      avgTerm: "",
      examExternal: [],
      creditClass: [],
    };
}

// --- Persistence ---
export function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch(e) { console.error("Save failed", e); }
}

export function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj) return;
      state = { ...initState(), ...obj };
    } catch(e) { console.error(e); }
}

export function resetState() {
    state = initState();
}

// --- Migration Logic ---
export function migrateState() {
    const parsePrefixed = (s) => {
      const m = String(s || "").match(/^(\d{3})-(\d)\s+(.+)$/);
      if (!m) return null;
      return { term: `${m[1]}${m[2]}`, name: m[3] };
    };

    state.base = (state.base || []).map((r) => {
      const rr = { ...r };
      if (rr.term) return rr;
      const parsed = parsePrefixed(rr.name);
      if (parsed) { rr.term = parsed.term; rr.name = parsed.name; }
      return rr;
    });

    state.adv = (state.adv || []).map((r) => {
      const rr = { ...r };
      if (rr.term) return rr;
      const parsed = parsePrefixed(rr.name);
      if (parsed) { rr.term = parsed.term; rr.name = parsed.name; }
      return rr;
    });

    state.externalCredits = state.externalCredits || [];
    state.creditClass = state.creditClass || [];
    state.examExternal = state.examExternal || [];

    for (const r of state.creditClass) {
      state.externalCredits.push({
        id: r.id || newUUID(),
        source: "creditClass",
        school: r.school || "",
        name: String(r.name || "").trim(),
        credit: CREDIT_CLASS_FIXED_CREDIT,
        grade: r.grade ?? "",
      });
    }
    state.creditClass = [];

    const isExactCreditClass = (name) => CREDIT_CLASS_SUBJECTS.includes(String(name || "").trim());
    for (const r of state.examExternal) {
      const nm = String(r?.name || "").trim();
      const cr = Math.round(toNum(r?.credit || 0));
      if (isExactCreditClass(nm) && cr === CREDIT_CLASS_FIXED_CREDIT) {
        state.externalCredits.push({
          id: r.id || newUUID(),
          source: "creditClass",
          school: r.school || "",
          name: nm,
          credit: CREDIT_CLASS_FIXED_CREDIT,
          grade: r.grade ?? "",
        });
      } else {
        state.externalCredits.push({
          id: r.id || newUUID(),
          source: "schoolCredit",
          school: r.school || "",
          name: nm,
          credit: cr || 0,
          grade: r.grade ?? "",
        });
      }
    }
    state.examExternal = [];

    const seen = new Set();
    state.externalCredits = (state.externalCredits || []).filter((r) => {
      const key = `${r.source}||${r.school || ""}||${r.name || ""}||${toNum(r.credit)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (typeof state.externalCourseEnabled !== "boolean") state.externalCourseEnabled = false;
}

// --- Data Fetching ---

function normalizeCourseRow(obj) {
    return {
      id: Number(obj.id) || 0,
      name: String(obj.name || "").trim(),
      teacher: String(obj.teacher || "").trim(),
      day: Number(obj.day) || 0,
      slots: Array.isArray(obj.slots) ? obj.slots : toSlots(obj.slots),
      credit: Number(obj.credit) || 0,
      isBase: !!obj.isBase,
      isLang: !!obj.isLang,
      CourseNumber: String(obj.CourseNumber || "").trim(),
      program: normalizeProgram(obj.program),
      isSmr: !!obj.isSmr,
    };
}

export async function initAllCourses(url = ALL_COURSES_CSV_URL) {
    try {
        systemStatus.coursesLoaded = false;
        systemStatus.coursesError = null;

        url = normalizeDriveUrl(url);
        if (!url) throw new Error("CSV URL is empty");
        const bust = (url.includes("?") ? "&" : "?") + "v=" + Date.now();
        const finalUrl = url + bust;

        const res = await fetch(finalUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
        const csvText = await res.text();
        if (/<!doctype html|<html/i.test(csvText)) {
            throw new Error("Fetched content looks like HTML, not CSV.");
        }

        const rows = parseCSV(csvText);
        if (!rows.length) throw new Error("CSV is empty");

        const headerRaw = rows[0].map((h) => String(h ?? ""));
        const header = headerRaw.map((h) => h.replace(/^\uFEFF/, "").trim());
        const headerLower = header.map((h) => h.toLowerCase());
        const idx = (key) => headerLower.indexOf(String(key || "").toLowerCase());

        const out = [];
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const get = (k) => csvUnquote(r[idx(k)] ?? "");
            const obj = {
                id: get("id"),
                name: get("name"),
                teacher: get("teacher"),
                day: get("day"),
                slots: get("slots"),
                credit: get("credit"),
                isBase: toBool(get("isBase")),
                isLang: toBool(get("isLang")),
                CourseNumber: get("CourseNumber"),
                program: get("program"),
                isSmr: idx("isSmr") !== -1 ? toBool(get("isSmr")) : false,
            };
            const c = normalizeCourseRow(obj);
            if (!c.id || !c.name || !c.program) continue;
            out.push(c);
        }
        allCourses = out;
        systemStatus.coursesLoaded = true;
    } catch (err) {
        systemStatus.coursesError = err.message;
        console.error("[Store] Failed to load courses:", err);
        allCourses = [];
    }
}

export async function initExternalDeptCsv() {
    externalDeptMapByCode = new Map();
    try {
        const res = await fetch(EXTERNAL_DEPT_CSV_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`External Dept CSV failed: ${res.status}`);
        const text = await res.text();
        
        const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        if (!lines.length) return { byCollege: new Map() };

        const head = lines[0];
        const start = (head.includes("學院") && head.includes("系所") && head.includes("代碼")) ? 1 : 0;
        const byCollege = new Map();

        for (let i = start; i < lines.length; i++) {
            const parts = lines[i].split(",").map((x) => stripCsvQuotes(x).trim());
            if (parts.length < 3) continue;
            const [college, name, codeRaw] = parts;
            const code = sanitizeDigits3(codeRaw);
            if (!college || !name || !/^\d{3}$/.test(code)) continue;

            externalDeptMapByCode.set(code, { college, name });
            if (!byCollege.has(college)) byCollege.set(college, []);
            byCollege.get(college).push({ code, name });
        }
        return { byCollege };
    } catch(e) {
        return { byCollege: new Map() };
    }
}
