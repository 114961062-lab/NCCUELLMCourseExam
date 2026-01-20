// ==========================================
// ui.js - 事件控制器 (Controller Layer)
// ==========================================
import { state, save, resetState, allCourses, externalDeptMapByCode, CONSTANTS } from './store.js';
import { newUUID, clampGradeValue, termOfCourse, yearOfCourse, termToLabel, sanitizeDigits3, sanitizeAlnum9 } from './utils.js';
import { 
    normalizeStatus, inferStatusByTermKey, ensureStatusConsistency, 
    guardCrossCaps, removeCourseById, clearTrack 
} from './logic.js';
import { buildPrintHtml } from './report.js';

// 🔴 關鍵：匯入 View 層
import { $, renderAll } from './view.js';

// --- Helpers ---
function getAdmissionYear() {
    const el = document.querySelector('input[name="admissionYear"]:checked');
    return (el?.value || "114").trim();
}

function composeStudentIdFull() {
    const ay = getAdmissionYear();
    const suffix = ($("studentId")?.value || "").trim();
    if (!suffix) return "";
    return `${ay}9610${suffix}`;
}

// --- Actions (修改 State) ---

function addSelectedCourse() {
    const pickCourseList = $("pickCourseList");
    let ids = [];
    if (pickCourseList) {
        ids = Array.from(pickCourseList.querySelectorAll('input:checked')).map(x => Number(x.getAttribute("data-cid"))).filter(n => n > 0);
    }
    if (!ids.length) return alert("請先勾選至少一門課程。");

    const prog = $("pickProgram").value;
    const isLLM = prog === "法碩專班";
    const level = isLLM ? ($("pickLevel")?.value || "adv") : "adv";
    
    let addedCount = 0;
    ids.forEach(cid => {
        const c = allCourses.find(x => Number(x.id) === cid);
        if (!c) return;
        const isSummerPick = ($("pickLevel")?.value === "summer_adv") || c.isSmr === true;
        const termKey = isSummerPick ? `${yearOfCourse(c)}S` : termOfCourse(c);
        const status = inferStatusByTermKey(termKey);
        const display = `${termToLabel(termKey)} ${c.name}`;
        
        // Dup check
        const dup = [...state.base, ...state.adv].some(r => r.courseRefId === Number(c.id));
        if (dup) return;

        const row = {
            id: newUUID(), courseRefId: Number(c.id), term: termKey, name: display,
            code: c.CourseNumber, credit: String(c.credit), grade: "",
            source: "internal", program: c.program, isLang: !!c.isLang,
            teacher: c.teacher, status: status, isSmr: isSummerPick
        };
        if (status === "planned") row.grade = "";

        const shouldBase = isLLM && level === "base" && !!c.isBase && c.isSmr !== true;
        if (shouldBase) {
            row.track = "base"; state.base.push(row);
        } else {
            row.track = "adv"; guardCrossCaps(row); state.adv.push(row);
        }
        state.courses.push(row);
        addedCount++;
    });

    if (addedCount > 0) { save(); renderAll(getAdmissionYear); } 
    else { alert("未新增課程 (可能已存在)。"); }
}

function addExternalToAdvanced() {
    if (!state.eligibleExempt || !state.externalCourseEnabled) return alert("請先啟用外院課程功能。");
    const code3 = sanitizeDigits3($("extDeptCode")?.value || $("extDept")?.value || "");
    const info = externalDeptMapByCode.get(code3);
    if (!info) return alert("系所代碼無效。");
    const code = sanitizeAlnum9($("extCode")?.value || "");
    if (code.length !== 9 || !code.startsWith(code3)) return alert("課程代碼格式錯誤 (需9碼且前3碼與系所一致)。");
    const name = ($("extName")?.value || "").trim();
    if (!name) return alert("請輸入課名。");

    const row = {
        id: newUUID(), term: $("extTerm")?.value || "", name: name, code: code,
        dept: info.name, deptCode: code3, credit: $("extCredit")?.value || "0",
        grade: "", source: "external", program: "外院",
        status: inferStatusByTermKey($("extTerm")?.value), track: "adv"
    };
    guardCrossCaps(row); state.adv.push(row); state.courses.push(row);
    $("extName").value = ""; $("extCode").value = "";
    save(); renderAll(getAdmissionYear);
}

function addTransferCourse() {
    const trName = $("trName")?.value || $("trNameBase")?.value || "";
    if(!trName) return alert("請輸入課程名稱");
    const trCredit = $("trCredit")?.value;
    if(!trCredit) return alert("請輸入學分");
    
    const row = {
        id: newUUID(), isTransfer: true, source: "transfer", status: "done",
        name: trName, credit: trCredit, grade: $("trGrade")?.value || "",
        transferYear: $("trYear")?.value || "",
        code: $("trCode")?.value || ""
    };
    
    if($("trLevel")?.value === "base") {
        row.track = "base"; state.base.push(row);
    } else {
        row.track = "adv"; state.adv.push(row);
    }
    state.courses.push(row);
    save(); renderAll(getAdmissionYear);
}

// --- Bind Events ---

export function bindEvents() {
    // 綁定渲染函數，方便初始化呼叫
    const doRender = () => renderAll(getAdmissionYear);

    document.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-act]");
        if (!btn) return;
        const act = btn.getAttribute("data-act");
        const idx = Number(btn.getAttribute("data-i"));

        if (act === "delBase") {
            const r = state.base[idx]; if(r) removeCourseById(r.id); state.base.splice(idx, 1);
        } else if (act === "delAdv") {
            const r = state.adv[idx]; if(r) removeCourseById(r.id); state.adv.splice(idx, 1);
        } else if (act === "delCreditClass" || act === "delExamExt" || act === "delExternalCredit") {
            state.externalCredits.splice(idx, 1);
        }
        save(); doRender();
    });

    const bindInput = (id, field) => {
        if ($(id)) $(id).addEventListener("input", (e) => { state[field] = e.target.value; save(); });
    };
    bindInput("studentName", "studentName");
    bindInput("note", "note");
    
    ["pickProgram", "pickTerm", "pickLevel", "pickLangLevel"].forEach(id => {
        if ($(id)) $(id).addEventListener("change", () => {
            // 這些只需要部分重繪，但為了簡單，我們呼叫 renderCoursePicker
            // 這裡直接呼叫 doRender 雖然 heavy 但最安全
            doRender();
        });
    });

    if ($("btnAddCourse")) $("btnAddCourse").addEventListener("click", addSelectedCourse);
    if ($("btnAddExternalToAdv")) $("btnAddExternalToAdv").addEventListener("click", addExternalToAdvanced);
    if ($("btnAddTransfer")) $("btnAddTransfer").addEventListener("click", addTransferCourse);

    if ($("studentId")) {
        $("studentId").addEventListener("change", (e) => { state.studentId = composeStudentIdFull(); save(); });
    }
    document.querySelectorAll('input[name="admissionYear"]').forEach(r => {
        r.addEventListener("change", () => { state.studentId = composeStudentIdFull(); save(); doRender(); });
    });
    
    // Checkboxes
    const bindCheck = (id, field) => {
        if($(id)) $(id).addEventListener("change", (e) => { state[field] = e.target.checked; save(); doRender(); });
    };
    bindCheck("eligibleExempt", "eligibleExempt");
    bindCheck("creditTransferEligible", "creditTransferEligible");
    bindCheck("externalCourseEnabled", "externalCourseEnabled");
    bindCheck("showExamAnalysis", "showExamAnalysis");

    // Print
    if ($("btnBuild")) $("btnBuild").addEventListener("click", () => {
        const html = buildPrintHtml(getAdmissionYear());
        const win = window.open("", "_blank");
        if(win) { win.document.write(html); win.document.close(); win.print(); }
    });
    
    // Reset
    if ($("btnReset")) $("btnReset").addEventListener("click", () => {
        if(confirm("確定重置?")) {
            resetState();
            localStorage.removeItem(CONSTANTS.STORAGE_KEY);
            location.reload();
        }
    });

    // Inputs in tables
    document.addEventListener("change", (e) => {
        const el = e.target;
        if (el.matches("input[data-k], select[data-k]")) {
            const s = el.getAttribute("data-s");
            const i = el.getAttribute("data-i");
            const k = el.getAttribute("data-k");
            let arr = state[s];
            if (s === "externalCredits") arr = state.externalCredits;
            
            if (arr && arr[i]) {
                if (k === "grade") arr[i].grade = clampGradeValue(el.value);
                if (k === "status") {
                    arr[i].status = normalizeStatus(el.value);
                    ensureStatusConsistency();
                }
                save(); doRender();
            }
        }
    });
    
    // Ext Dept logic
    if($("extDept")) $("extDept").addEventListener("change", () => {
        if($("extDeptCode")) $("extDeptCode").value = $("extDept").value;
    });
    if($("extDeptCode")) $("extDeptCode").addEventListener("input", (e) => {
        const v = sanitizeDigits3(e.target.value);
        if($("extDept")) $("extDept").value = v;
    });
    if($("trLevel")) $("trLevel").addEventListener("change", (e) => {
        const isBase = e.target.value === "base";
        if($("trNameBase")) $("trNameBase").classList.toggle("hidden", !isBase);
        if($("trName")) $("trName").classList.toggle("hidden", isBase);
    });
}

// 匯出 renderAll 讓 main.js 呼叫初始化
export { renderAll } from './view.js';
// 為了讓 main.js 初始化時能傳入參數，我們也可以在這裡封裝一下，但直接匯出 view.js 的比較簡單
// 注意：main.js 呼叫 renderAll() 時不會帶參數， view.js 的 renderAll 有預設行為嗎？
// view.js 的 renderAll(getAdmissionYear) 需要一個 function。
// 我們可以 export 一個包裝過的 init
export function initUI() {
    renderAll(getAdmissionYear);
}
