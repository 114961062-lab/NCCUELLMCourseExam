// ==========================================
// services.js - 資料存取層
// ==========================================
import { ALL_COURSES_CSV_URL, EXTERNAL_DEPT_CSV_URL } from './config.js';

function __csvUnquote(s) {
    if (s == null) return "";
    s = String(s);
    if (s.startsWith('"') && s.endsWith('"')) {
        s = s.slice(1, -1).replace(/""/g, '"');
    }
    return s;
}

function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;
    const pushCell = () => { row.push(cur); cur = ""; };
    const pushRow = () => {
        if (row.length === 1 && String(row[0] || "").trim() === "") { row = []; return; }
        rows.push(row); row = [];
    };
    const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inQuotes) {
            if (ch === '"') {
                if (s[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
            } else { cur += ch; }
            continue;
        }
        if (ch === '"') { inQuotes = true; continue; }
        if (ch === ",") { pushCell(); continue; }
        if (ch === "\n") { pushCell(); pushRow(); continue; }
        cur += ch;
    }
    pushCell(); pushRow();
    return rows;
}

function normalizeProgram(p) {
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

function normalizeCourseRow(obj) {
    const toBool = (v) => { const s = String(v ?? "").trim().toLowerCase(); return s === "true" || s === "1" || s === "y" || s === "yes"; };
    const toSlots = (v) => { const s = String(v ?? "").trim(); return s ? s.split("|").map(x => String(x).trim()).filter(Boolean) : []; };
    
    return {
        id: Number(obj.id) || 0,
        name: String(obj.name || "").trim(),
        teacher: String(obj.teacher || "").trim(),
        day: Number(obj.day) || 0,
        slots: Array.isArray(obj.slots) ? obj.slots : toSlots(obj.slots),
        credit: Number(obj.credit) || 0,
        isBase: toBool(obj.isBase),
        isLang: toBool(obj.isLang),
        CourseNumber: String(obj.CourseNumber || "").trim(),
        program: normalizeProgram(obj.program),
        isSmr: toBool(obj.isSmr),
    };
}

export async function loadAllCoursesFromCSV() {
    const url = ALL_COURSES_CSV_URL;
    const bust = (url.includes("?") ? "&" : "?") + "v=" + Date.now();
    const res = await fetch(url + bust, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
    const csvText = await res.text();
    if (/<!doctype html|<html/i.test(csvText)) throw new Error("Fetched HTML instead of CSV.");
    
    const rows = parseCSV(csvText);
    if (!rows.length) throw new Error("CSV is empty");
    
    const headerRaw = rows[0].map(h => String(h ?? ""));
    const headerLower = headerRaw.map(h => h.replace(/^\uFEFF/, "").trim().toLowerCase());
    const idx = (key) => headerLower.indexOf(String(key || "").toLowerCase());
    
    const out = [];
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const get = (k) => __csvUnquote(r[idx(k)] ?? "");
        const obj = {
            id: get("id"), name: get("name"), teacher: get("teacher"), day: get("day"),
            slots: get("slots"), credit: get("credit"), isBase: get("isBase"),
            isLang: get("isLang"), CourseNumber: get("CourseNumber"), program: get("program"),
            isSmr: idx("isSmr") !== -1 ? get("isSmr") : "0"
        };
        const c = normalizeCourseRow(obj);
        if (!c.id || !c.name || !c.program) continue;
        out.push(c);
    }
    return out;
}

export async function loadExternalDeptCsv() {
    const res = await fetch(EXTERNAL_DEPT_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`External Dept CSV failed: ${res.status}`);
    const text = await res.text();
    if (/<!doctype html|<html/i.test(text)) throw new Error("External Dept CSV is HTML.");
    
    const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const start = (lines[0] && lines[0].includes("學院")) ? 1 : 0;
    
    const map = new Map();
    for (let i = start; i < lines.length; i++) {
        const parts = lines[i].split(",").map(x => __csvUnquote(x).trim());
        if (parts.length < 3) continue;
        const [college, name, codeRaw] = parts;
        const code = String(codeRaw || "").replace(/\D/g, "").slice(0, 3);
        if (!college || !name || !/^\d{3}$/.test(code)) continue;
        map.set(code, { college, name });
    }
    return map;
}
