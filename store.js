// ==========================================
// store.js - 狀態管理
// ==========================================
import { newUUID } from './utils.js';
import { CONSTANTS } from './config.js';
import { loadAllCoursesFromCSV, loadExternalDeptCsv } from './services.js';

// Exports for other modules
export { CONSTANTS, BASE_SUBJECTS_MAP, Base_CLASS_SUBJECTS_114 } from './config.js';

export let allCourses = [];
export let externalDeptMapByCode = new Map();
export const systemStatus = { coursesLoaded: false, coursesError: null };

function initState() {
    return {
        admissionYear: "114", 
        studentName: "", studentId: "", note: "",
        eligibleExempt: false, externalCourseEnabled: false,
        eligibleType: "degree", eligibleDegree: "", eligibleCredential: "",
        creditTransferEligible: false, showExamAnalysis: false,
        courses: [], base: [], adv: [], externalCredits: [],
        avgMode: "term", avgTerm: ""
    };
}

export let state = initState();

export function save() { localStorage.setItem(CONSTANTS.STORAGE_KEY, JSON.stringify(state)); }

export function load() {
    try {
        const raw = localStorage.getItem(CONSTANTS.STORAGE_KEY);
        if (raw) state = { ...initState(), ...JSON.parse(raw) };
    } catch {}
}

export function resetState() { state = initState(); }

export function migrateState() {
    const parsePrefixed = (s) => {
        const m = String(s || "").match(/^(\d{3})-(\d)\s+(.+)$/);
        return m ? { term: `${m[1]}${m[2]}`, name: m[3] } : null;
    };
    state.base = (state.base || []).map(r => {
        if (!r.term) { const p = parsePrefixed(r.name); if(p) { r.term = p.term; r.name = p.name; } }
        return r;
    });
    state.adv = (state.adv || []).map(r => {
        if (!r.term) { const p = parsePrefixed(r.name); if(p) { r.term = p.term; r.name = p.name; } }
        return r;
    });
    state.externalCredits = state.externalCredits || [];
}

export async function initAllCourses() {
    try {
        systemStatus.coursesLoaded = false;
        allCourses = await loadAllCoursesFromCSV();
        systemStatus.coursesLoaded = true;
    } catch (err) {
        systemStatus.coursesError = err.message;
        allCourses = [];
    }
}

export async function initExternalDeptCsv() {
    try {
        externalDeptMapByCode = await loadExternalDeptCsv();
    } catch (e) { console.error("External Dept CSV Error:", e); }
}
