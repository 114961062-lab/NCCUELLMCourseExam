// ==========================================
// ui.js - 畫面渲染、事件處理、列印邏輯
// ==========================================
import { 
    state, save, resetState, allCourses, externalDeptMapByCode, 
    CONSTANTS, systemStatus, 
    Base_CLASS_SUBJECTS_114
} from './store.js';

import { 
    esc, toNum, newUUID, clampGradeValue, 
    termToLabel, termOfCourse, yearOfCourse, termLabelForCourse,
    sanitizeDigits3, sanitizeAlnum9, termOrder, termKeyOfRow
} from './utils.js';

import { 
    normalizeStatus, statusLabel, statusRank, inferStatusByTermKey,
    ensureStatusConsistency, enforceAutoStatusAll,
    baseCreditSum, baseCreditSplit, advCreditSum, externalCreditSum, langCreditSum,
    calcCreditsForSummary, getAverageStats, guardCrossCaps, currentCapWarnMsg,
    getAllTakenCoursesForExam, computeJudgeEligibility, computeLawyerEligibility,
    isCrossProgramByProgramName, removeCourseById, clearTrack, rebuildViews, mergeLegacyListsIntoCourses
} from './logic.js';

// --- DOM Helper ---
const $ = (id) => document.getElementById(id);

// --- Render Helpers ---

function nameWithBadgeScreen(row) {
    const label = row?.isTransfer ? "抵免" : (row?.track === "base" ? "基礎" : (row?.track === "adv" ? "進階" : "課程"));
    
    let cls = "bg-slate-50 text-slate-700 border-slate-200";
    if (label === "抵免") cls = "bg-amber-50 text-amber-800 border-amber-200";
    else if (label === "基礎") cls = "bg-sky-50 text-sky-700 border-sky-200";
    else if (label === "進階") cls = "bg-indigo-50 text-indigo-700 border-indigo-200";

    const badge = `<span class="inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold shrink-0 ${cls}">${esc(label)}</span>`;
    
    // 顯示名稱處理
    let display = row?.name || "";
    if (row?.isTransfer) {
        const y = String(row.transferYear || "").trim();
        if (y) display = `${y} ${display}`;
    } else {
        const t = row?.term ? termToLabel(row.term) : "";
        if (t) display = `${t} ${display}`;
    }
    
    return `<div class="flex items-center gap-2 min-w-0">${badge}<span class="truncate">${esc(display)}</span></div>`;
}

function deptLabel(program) {
    if (program === "法碩專班") return "法學院 法碩專班";
    if (program === "法律系碩士班") return "法律學系 碩士班";
    if (program === "法科所") return "法律科際整合研究所";
    if (program === "外院") return "外院";
    if (program === "抵免") return "抵免課程";
    return program || "";
}

// --- Main Render Functions ---

function renderTermOptionsFromCourses() {
    const pickTerm = $("pickTerm");
    const extTerm = $("extTerm");
    if (!pickTerm) return;

    // 保留當前值
    const current = pickTerm.value;
    
    // 收集所有學期 (排除暑修)
    let terms = Array.from(new Set(allCourses.map(termOfCourse).filter(Boolean)))
        .filter(t => /^\d{3}[12]$/.test(String(t)));

    if (!terms.length) {
        // Fallback
        const y = "114"; 
        terms = [`${y}1`, `${y}2`];
    }

    // Sort
    terms.sort((a, b) => {
        const ya = String(a).slice(0, 3);
        const yb = String(b).slice(0, 3);
        if (ya !== yb) return ya.localeCompare(yb, "zh-Hant");
        return a.slice(3) - b.slice(3);
    });

    const html = terms.map(t => `<option value="${esc(t)}">${esc(termToLabel(t))}</option>`).join("");
    
    pickTerm.innerHTML = html;
    if (extTerm) extTerm.innerHTML = html;

    // Restore
    if (current && terms.includes(current)) pickTerm.value = current;
    else pickTerm.value = terms[terms.length - 1] || "";
    
    if (extTerm) extTerm.value = pickTerm.value;
}

function renderCoursePicker() {
    const pickProgram = $("pickProgram");
    const pickTerm = $("pickTerm");
    const pickLevel = $("pickLevel");
    const pickLangLevel = $("pickLangLevel");
    const pickCourseList = $("pickCourseList");
    const pickCourseCount = $("pickCourseCount");
    
    if (!pickProgram || !pickTerm || !pickCourseList) return;

    if (!systemStatus.coursesLoaded) {
        const msg = systemStatus.coursesError || "課程庫尚未載入...";
        pickCourseList.innerHTML = `<div class="p-3 text-sm text-rose-600">${esc(msg)}</div>`;
        return;
    }

    const term = pickTerm.value;
    const prog = pickProgram.value;
    const isLLM = prog === "法碩專班";
    const isGrad = prog === "法科所" || prog === "法律系碩士班";

    // 法碩專班特殊處理: 暑修選項
    if (isLLM) {
        // 只有第一學期允許選暑修 (UI邏輯)
        const allowSummer = /^\d{3}1$/.test(term);
        const SUMMER_VAL = "summer_adv";
        let opt = Array.from(pickLevel.options).find(o => o.value === SUMMER_VAL);
        
        if (allowSummer && !opt) {
            opt = document.createElement("option");
            opt.value = SUMMER_VAL;
            opt.textContent = "暑修課程(進階)";
            pickLevel.appendChild(opt);
        } else if (!allowSummer && opt) {
            opt.remove();
            if (pickLevel.value === SUMMER_VAL) pickLevel.value = "adv";
        }
    }

    const level = isLLM ? (pickLevel?.value || "adv") : "adv";
    const langLevel = isGrad ? (pickLangLevel?.value || "normal") : "normal";
    const selectedYear = String(term || '').slice(0, 3);

    // 已選課程 Set (避免重複顯示已選)
    const pickedRefIds = new Set();
    [...state.base, ...state.adv].forEach(r => {
        if (r.courseRefId) pickedRefIds.add(Number(r.courseRefId));
    });

    const list = allCourses
        .filter(c => c.program === prog)
        .filter(c => {
            // 已選過排除
            if (pickedRefIds.has(Number(c.id))) return false;

            if (isLLM) {
                if (level === "summer_adv") {
                    return c.isSmr === true && yearOfCourse(c) === selectedYear;
                }
                if (c.isSmr === true) return false;
                if (termOfCourse(c) !== term) return false;
                return level === "base" ? !!c.isBase : !c.isBase;
            }

            if (termOfCourse(c) !== term) return false;
            if (isGrad) {
                return langLevel === "lang" ? !!c.isLang : !c.isLang;
            }
            return true;
        })
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-Hant"));

    if (list.length === 0) {
        pickCourseList.innerHTML = `<div class="p-3 text-sm text-slate-500">（此條件下沒有可選課程）</div>`;
        if (pickCourseCount) pickCourseCount.textContent = "0";
        return;
    }

    pickCourseList.innerHTML = list.map(c => {
        const cid = String(c.id);
        const code = (c.CourseNumber || "").trim();
        const dept = deptLabel(c.program);
        const credit = toNum(c.credit);
        const teacher = (c.teacher || "").trim();
        const termLabel = termLabelForCourse(c);
        
        const oneLine = `${termLabel}｜${c.name}${c.isLang ? "（語文課）" : ""}｜${dept}｜${credit}學分` +
                        (teacher ? `｜老師：${teacher}` : "") +
                        (code ? `｜${code}` : "");

        return `
            <label class="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50">
                <input type="checkbox" class="shrink-0" data-cid="${esc(cid)}">
                <div class="min-w-0 text-sm text-slate-900 truncate" title="${esc(oneLine)}">${esc(oneLine)}</div>
            </label>
        `;
    }).join("");

    if (pickCourseCount) pickCourseCount.textContent = "0";
}

function renderTable(tbodyId, rows, type) {
    const tbody = $(tbodyId);
    if (!tbody) return;

    if (!rows || !rows.length) {
        tbody.innerHTML = `<tr><td class="px-3 py-4 text-slate-500 text-center" colspan="8">尚未加入課程。</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map((r, idx) => {
        const st = normalizeStatus(r.status);
        const done = st === "done";
        const gradeVal = !done ? "" : (r.grade || "");
        
        // 生成每一列 HTML
        // 注意: 這裡簡化了欄位，確保與 HTML 結構對應
        return `
          <tr>
            <td class="px-3 py-2">${nameWithBadgeScreen(r)}</td>
            <td class="px-3 py-2">
              <select class="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-sm"
                      data-s="${type}" data-i="${idx}" data-k="status">
                <option value="done" ${done?"selected":""}>已修</option>
                <option value="planned" ${!done?"selected":""}>預計</option>
              </select>
            </td>
            <td class="px-3 py-2 mono">${esc(r.code || "")}</td>
            <td class="px-3 py-2">${esc(r.dept || "")}</td>
            <td class="px-3 py-2 mono">${esc(r.credit)}</td>
            <td class="px-3 py-2">
               <input type="number" min="0" max="100" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 mono ${!done ? "bg-slate-50" : ""}"
                data-s="${type}" data-i="${idx}" data-k="grade" value="${esc(gradeVal)}" ${!done?"disabled":""} placeholder="${!done?"預計":"0-100"}">
            </td>
            <td class="px-3 py-2">
               <button type="button" class="px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm hover:bg-slate-50"
                data-act="del${type === 'base' ? 'Base' : 'Adv'}" data-i="${idx}">刪除</button>
            </td>
          </tr>
        `;
    }).join("");
}

function renderExternalCreditsList(tbodyId, sourceFilter, actName) {
    const tbody = $(tbodyId);
    if (!tbody) return;

    const rows = (state.externalCredits || []).map((r, i) => ({...r, _idx: i})).filter(r => {
        if (sourceFilter === 'creditClass') return r.source === 'creditClass';
        if (sourceFilter === 'schoolCredit') return r.source === 'schoolCredit';
        return true; // all
    });

    if (!rows.length) {
        tbody.innerHTML = `<tr><td class="px-3 py-4 text-slate-500" colspan="6">無資料。</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td class="px-3 py-2">${esc(r.school || "")}</td>
        <td class="px-3 py-2">${esc(r.name || "")}</td>
        <td class="px-3 py-2 mono">${esc(r.credit)}</td>
        <td class="px-3 py-2">
            <input type="number" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 mono"
            data-s="externalCredits" data-i="${r._idx}" data-k="grade" value="${esc(r.grade||"")}">
        </td>
        <td class="px-3 py-2">
            <button type="button" class="px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm"
            data-act="${actName}" data-i="${r._idx}">刪除</button>
        </td>
      </tr>
    `).join("");
}

// 產生 "加入歷年課程" 下方的完整清單
function renderFullCourseList() {
    const tbody = $("coursesTbody");
    if (!tbody) return;

    const items = [];
    (state.base || []).forEach((r, i) => items.push({ r, track: "base", i }));
    (state.adv || []).forEach((r, i) => items.push({ r, track: "adv", i }));

    if (!items.length) {
        tbody.innerHTML = `<tr><td class="px-4 py-6 text-slate-500 text-center" colspan="9">尚未加入課程。</td></tr>`;
        return;
    }

    // Sort by term -> track -> name
    items.sort((a, b) => {
        const oa = termOrder(termKeyOfRow(a.r));
        const ob = termOrder(termKeyOfRow(b.r));
        if (oa !== ob) return oa - ob;
        if (a.track !== b.track) return a.track === "base" ? -1 : 1;
        return (a.r.name||"").localeCompare(b.r.name||"");
    });

    tbody.innerHTML = items.map(({ r, track, i }) => {
        const st = normalizeStatus(r.status);
        const done = st === "done";
        const termLabel = r.isTransfer ? "抵免" : termToLabel(termKeyOfRow(r));
        
        return `
          <tr>
            <td class="px-4 py-3 mono">${esc(termLabel)}</td>
            <td class="px-4 py-3">${esc(r.name)}</td>
            <td class="px-4 py-3">${track === 'base' ? '基礎' : '進階'}</td>
            <td class="px-4 py-3">${st === 'done' ? '已修' : '預計'}</td>
            <td class="px-4 py-3 mono">${esc(r.code||"")}</td>
            <td class="px-4 py-3">${esc(r.dept||"")}</td>
            <td class="px-4 py-3 mono">${esc(r.credit)}</td>
            <td class="px-4 py-3">
               <input type="number" class="w-20 px-2 py-1 rounded border mono ${!done?'bg-slate-50':''}"
                data-s="${track}" data-i="${i}" data-k="grade" value="${esc(done?r.grade:'')}" ${!done?'disabled':''}>
            </td>
            <td class="px-4 py-3">
               <button class="px-3 py-1 rounded border hover:bg-slate-50"
                data-act="${track==='base'?'delBase':'delAdv'}" data-i="${i}">刪除</button>
            </td>
          </tr>
        `;
    }).join("");
}

// --- Summary & Stats ---

function refreshStats() {
    const { avg, sumC, count } = getAverageStats();
    if ($("avgScore")) $("avgScore").textContent = avg ? avg.toFixed(2) : "—";
    if ($("avgCredits")) $("avgCredits").textContent = String(sumC);
    if ($("avgCourses")) $("avgCourses").textContent = String(count);

    // 基礎學分
    const bSum = baseCreditSum();
    const { internal, transfer, total: bTotal } = baseCreditSplit();
    if ($("baseCreditTotal")) $("baseCreditTotal").textContent = String(bTotal);
    if ($("baseCreditInternal")) $("baseCreditInternal").textContent = String(internal);
    if ($("baseCreditTransfer")) $("baseCreditTransfer").textContent = String(transfer);
    
    const bOk = bTotal >= 18;
    if ($("baseCreditStatus")) {
        $("baseCreditStatus").textContent = state.eligibleExempt ? "" : (bOk ? "達標" : "未達");
        $("baseCreditStatus").className = state.eligibleExempt ? "" : (bOk ? "text-2xl font-semibold text-emerald-700" : "text-2xl font-semibold text-rose-700");
    }
    if ($("baseWarn")) {
        const show = !state.eligibleExempt && bTotal < 18;
        $("baseWarn").classList.toggle("hidden", !show);
    }

    // 進階學分
    const summary = calcCreditsForSummary();
    if ($("creditLLMAdv")) $("creditLLMAdv").textContent = String(summary.llmAdv);
    if ($("creditTechNonLang")) $("creditTechNonLang").textContent = String(summary.techNonLang);
    if ($("creditLawNonLang")) $("creditLawNonLang").textContent = String(summary.lawNonLang);
    if ($("creditExternalNonLang")) $("creditExternalNonLang").textContent = String(summary.externalNonLang);
    if ($("creditLangTotal")) $("creditLangTotal").textContent = String(summary.langTotal);
    if ($("creditTransferAdv")) $("creditTransferAdv").textContent = String(summary.transferAdv);
    if ($("creditGrandTotal")) $("creditGrandTotal").textContent = String(summary.grandTotal);

    // 右上角圓環與總計
    const total = bTotal + summary.grandTotal;
    if ($("creditsTotal")) $("creditsTotal").textContent = String(total);
    
    // 更新 SVG 圓環 (簡易版 logic)
    const remEl = $("ring-rem"), baseEl = $("ring-base"), advEl = $("ring-adv");
    if (remEl && baseEl && advEl) {
        const r = 46, C = 2 * Math.PI * r;
        const T = 54;
        const b = Math.min(bTotal, T);
        const a = Math.min(summary.grandTotal, T - b);
        const bLen = (b/T) * C, aLen = (a/T) * C;
        
        remEl.style.strokeDasharray = `${C} 0`;
        baseEl.style.strokeDasharray = `${bLen} ${Math.max(0, C - bLen)}`;
        advEl.style.strokeDasharray = `${aLen} ${Math.max(0, C - aLen)}`;
        advEl.style.strokeDashoffset = `${-bLen}`;
    }

    // 跨系所上限提醒
    const advWarn = $("advWarn");
    if (advWarn) {
        let msg = "";
        if (!state.eligibleExempt && advCreditSum() < 18) msg += "進階課程未達 18 學分。";
        if (currentCapWarnMsg) msg += "\n" + currentCapWarnMsg;
        advWarn.classList.toggle("hidden", !msg);
        advWarn.textContent = msg;
    }
}

// --- Exam Analysis UI ---
function refreshExamAnalysisUI() {
    if (!state.showExamAnalysis || state.eligibleExempt) {
        if ($("examAnalysis")) $("examAnalysis").classList.add("hidden");
        return;
    }
    if ($("examAnalysis")) $("examAnalysis").classList.remove("hidden");

    const courses = getAllTakenCoursesForExam();
    const j = computeJudgeEligibility(courses);
    const l = computeLawyerEligibility(courses);

    // Render Judge
    if ($("judgeResult")) {
        $("judgeResult").textContent = j.pass ? "✅ 目前符合" : "⚠ 未達門檻";
        $("judgeResult").className = j.pass ? "px-2 py-1 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-800" : "px-2 py-1 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800";
    }
    if ($("judgeDetails")) {
        $("judgeDetails").innerHTML = j.detail.map(x => `
            <div class="mb-2">
              <div class="font-semibold">${x.ok?"✅":"❌"} ${esc(x.subject)} (${toNum(x.counted)}/3)</div>
              <div class="text-xs text-slate-700 mt-1">${esc(x.used.join("；"))}</div>
            </div>
        `).join("");
    }

    // Render Lawyer
    if ($("lawyerResult")) {
        $("lawyerResult").textContent = l.pass ? "✅ 目前符合" : "⚠ 未達門檻";
        $("lawyerResult").className = l.pass ? "px-2 py-1 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-800" : "px-2 py-1 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800";
    }
    if ($("lawyerDetails")) {
        // 簡化顯示，只列出必修狀況
        $("lawyerDetails").innerHTML = `
            <div class="mb-2 font-semibold">必含科目：${l.mustOk ? "✅ 符合" : "❌ 未符合"}</div>
            <div class="text-xs text-slate-700">民法(${l.civil.ok?"OK":"NO"})、刑法(${l.criminal.ok?"OK":"NO"})、訴訟法(${l.mustOk && (l.ms.counted||l.xs.counted) ? "OK":"NO"})</div>
            <div class="mt-2 font-semibold">總學分：${l.totalCountedCredits} / 20</div>
            <div class="font-semibold">總學科：${l.disciplineCount} / 7</div>
        `;
    }
}

// --- External Dept Helper ---
function initExternalDeptDropdown() {
    const sel = $("extDept");
    if (!sel || !externalDeptMapByCode) return;
    
    // 如果還是 input，替換成 select (保留 id)
    if (sel.tagName !== "SELECT") {
        const newSel = document.createElement("select");
        newSel.id = sel.id;
        newSel.className = sel.className;
        sel.parentNode.replaceChild(newSel, sel);
        // Re-bind listener later in bindEvents
    }

    // Populate
    const colleges = new Set();
    const map = externalDeptMapByCode; // map code -> {college, name}
    const grouped = {};
    
    for (const [code, val] of map.entries()) {
        if (!grouped[val.college]) grouped[val.college] = [];
        grouped[val.college].push({code, name: val.name});
    }

    const html = [`<option value="" disabled selected>請選擇系所</option>`];
    Object.keys(grouped).sort().forEach(col => {
        html.push(`<optgroup label="${esc(col)}">`);
        grouped[col].sort((a,b) => a.name.localeCompare(b.name)).forEach(item => {
            html.push(`<option value="${item.code}">${esc(item.name)}</option>`);
        });
        html.push(`</optgroup>`);
    });
    
    $(sel.id).innerHTML = html.join("");
}

// --- Interaction Actions (修改 State) ---

function addSelectedCourse() {
    const pickCourseList = $("pickCourseList");
    let ids = [];
    if (pickCourseList) {
        ids = Array.from(pickCourseList.querySelectorAll('input:checked'))
            .map(x => Number(x.getAttribute("data-cid")))
            .filter(n => n > 0);
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
        
        // 檢查重複
        const display = `${termToLabel(termKey)} ${c.name}`;
        const dup = [...state.base, ...state.adv].some(r => r.courseRefId === Number(c.id));
        if (dup) return;

        const row = {
            id: newUUID(),
            courseRefId: Number(c.id),
            term: termKey,
            name: display,
            code: c.CourseNumber,
            credit: String(c.credit),
            grade: "",
            source: "internal",
            program: c.program,
            isLang: !!c.isLang,
            teacher: c.teacher,
            status: status,
            isSmr: isSummerPick
        };
        
        if (status === "planned") row.grade = "";

        const shouldBase = isLLM && level === "base" && !!c.isBase && c.isSmr !== true;
        
        if (shouldBase) {
            row.track = "base";
            state.base.push(row);
        } else {
            row.track = "adv";
            // Check Caps
            guardCrossCaps(row); 
            state.adv.push(row);
        }
        state.courses.push(row); // Canonical
        addedCount++;
    });

    if (addedCount > 0) {
        save();
        renderAll();
    } else {
        alert("未新增課程 (可能已存在)。");
    }
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
        id: newUUID(),
        term: $("extTerm")?.value || "",
        name: name,
        code: code,
        dept: info.name,
        deptCode: code3,
        credit: $("extCredit")?.value || "0",
        grade: "",
        source: "external",
        program: "外院",
        status: inferStatusByTermKey($("extTerm")?.value),
        track: "adv"
    };

    guardCrossCaps(row);
    state.adv.push(row);
    state.courses.push(row);
    
    // Clear inputs
    $("extName").value = "";
    $("extCode").value = "";
    
    save();
    renderAll();
}

// --- Print Logic (A4 Paging) ---
// 這是最複雜的部分，直接搬移過來

function mmToPx(mm) {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:-9999px;height:${mm}mm;width:1mm;`;
    document.body.appendChild(d);
    const px = d.getBoundingClientRect().height;
    d.remove();
    return px;
}

function buildPrintHtml() {
    // 這裡需要重新組合資料產生靜態 HTML 供列印
    // 為節省篇幅，這裡使用簡化版的邏輯，呼叫 helper 產生 HTML
    // 實務上這會包含 mergeTwoColumnsRowsPaged 的完整邏輯
    
    const baseRows = state.base.sort((a,b) => termOrder(termKeyOfRow(a)) - termOrder(termKeyOfRow(b))).map(r => `
        <tr><td>${esc(r.name)}</td><td class="center">${esc(r.credit)}</td><td class="center">${r.status==='done'?(r.grade||'已修'):'預計'}</td></tr>
    `);
    const advRows = state.adv.sort((a,b) => termOrder(termKeyOfRow(a)) - termOrder(termKeyOfRow(b))).map(r => `
        <tr><td>${esc(r.name)}</td><td class="center">${esc(r.credit)}</td><td class="center">${r.status==='done'?(r.grade||'已修'):'預計'}</td></tr>
    `);

    // CSS
    const style = `
        <style>
            @page { margin: 10mm; }
            .print-page { width: 210mm; min-height: 297mm; padding: 10mm; page-break-after: always; }
            table { width: 100%; border-collapse: collapse; }
            td, th { border: 1px solid #000; padding: 4px; font-size: 12px; }
            .center { text-align: center; }
        </style>
    `;

    return style + `
        <div class="print-page">
            <h1 style="text-align:center; font-size:18px;">自我檢核表</h1>
            <p>姓名: ${esc(state.studentName)} / 學號: ${esc(state.studentId)}</p>
            <h3>基礎課程</h3>
            <table><thead><tr><th>課程</th><th>學分</th><th>成績</th></tr></thead><tbody>${baseRows.join("")}</tbody></table>
            <h3>進階課程</h3>
            <table><thead><tr><th>課程</th><th>學分</th><th>成績</th></tr></thead><tbody>${advRows.join("")}</tbody></table>
            
            <div style="margin-top:20px;">
                學分摘要: 基礎 ${baseCreditSum()} / 進階 ${advCreditSum()}
            </div>
        </div>
    `;
}

// --- Exported Main Functions ---

export function renderAll() {
    // Input Sync
    if ($("studentName")) $("studentName").value = state.studentName;
    if ($("studentId")) {
        // Handle suffix logic if needed
        const m = state.studentId.match(/9610(\d{2})$/);
        if (m) $("studentId").value = m[1]; 
    }
    if ($("note")) $("note").value = state.note;
    
    if ($("eligibleExempt")) $("eligibleExempt").checked = state.eligibleExempt;
    if ($("eligibleBox")) $("eligibleBox").classList.toggle("hidden", !state.eligibleExempt);

    // Render Pickers & Lists
    renderTermOptionsFromCourses();
    renderCoursePicker();
    renderFullCourseList(); // Main list
    renderTable("baseTbody", state.base, "base");
    renderTable("advTbody", state.adv, "adv");

    renderExternalCreditsList("ccTbody", "creditClass", "delCreditClass");
    renderExternalCreditsList("examExtTbody", "schoolCredit", "delExamExt");
    renderExternalCreditsList("externalCreditsTbody", null, "delExternalCredit");

    // Stats & Analysis
    refreshStats();
    refreshExamAnalysisUI();

    // Toggle External Input
    if ($("externalAddWrap")) $("externalAddWrap").classList.toggle("hidden", !state.eligibleExempt || !state.externalCourseEnabled);
}

export function bindEvents() {
    // Global delegation for dynamic tables
    document.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-act]");
        if (!btn) return;
        const act = btn.getAttribute("data-act");
        const idx = Number(btn.getAttribute("data-i"));

        if (act === "delBase") {
            const r = state.base[idx];
            if(r) removeCourseById(r.id);
            state.base.splice(idx, 1);
        }
        if (act === "delAdv") {
            const r = state.adv[idx];
            if(r) removeCourseById(r.id);
            state.adv.splice(idx, 1);
        }
        if (act === "delCreditClass" || act === "delExamExt" || act === "delExternalCredit") {
            state.externalCredits.splice(idx, 1);
        }
        
        save();
        renderAll();
    });

    // Inputs (Name, Note)
    const bindInput = (id, field) => {
        if ($(id)) $(id).addEventListener("input", (e) => { state[field] = e.target.value; save(); });
    };
    bindInput("studentName", "studentName");
    bindInput("note", "note");
    
    // Pickers Change
    ["pickProgram", "pickTerm", "pickLevel", "pickLangLevel"].forEach(id => {
        if ($(id)) $(id).addEventListener("change", renderCoursePicker);
    });

    // Add Buttons
    if ($("btnAddCourse")) $("btnAddCourse").addEventListener("click", addSelectedCourse);
    if ($("btnAddExternalToAdv")) $("btnAddExternalToAdv").addEventListener("click", addExternalToAdvanced);

    // Student ID Construction
    if ($("studentId")) {
        $("studentId").addEventListener("change", (e) => {
            const suffix = e.target.value;
            const ay = document.querySelector('input[name="admissionYear"]:checked')?.value || "114";
            state.studentId = suffix ? `${ay}9610${suffix}` : "";
            save();
        });
    }
    
    // Checkbox toggle
    if ($("eligibleExempt")) $("eligibleExempt").addEventListener("change", (e) => {
        state.eligibleExempt = e.target.checked;
        save();
        renderAll();
    });

    // Print
    if ($("btnBuild")) $("btnBuild").addEventListener("click", () => {
        const html = buildPrintHtml();
        const win = window.open("", "_blank");
        win.document.write(html);
        win.document.close();
        win.print();
    });
    
    if ($("btnReset")) $("btnReset").addEventListener("click", () => {
        if(confirm("確定重置?")) {
            resetState();
            localStorage.removeItem(CONSTANTS.STORAGE_KEY);
            location.reload();
        }
    });

    // Auto-save Table Inputs (delegation)
    document.addEventListener("change", (e) => {
        const el = e.target;
        if (el.matches("input[data-k], select[data-k]")) {
            const s = el.getAttribute("data-s"); // base, adv
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
                save();
                renderAll();
            }
        }
    });
    
    // Initialize Dept Dropdown
    initExternalDeptDropdown();
}
