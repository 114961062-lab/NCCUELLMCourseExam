// ==========================================
// ui.js - 畫面渲染、事件處理、列印邏輯 (完整版)
// ==========================================
import { 
    state, save, resetState, allCourses, externalDeptMapByCode, 
    CONSTANTS, systemStatus, Base_CLASS_SUBJECTS_114 
} from './store.js';

import { 
    esc, toNum, newUUID, clampGradeValue, 
    termToLabel, termOfCourse, yearOfCourse, termLabelForCourse,
    sanitizeDigits3, sanitizeAlnum9, pad2
} from './utils.js';

import { 
    normalizeStatus, statusLabel, statusRank, inferStatusByTermKey,
    ensureStatusConsistency, termKeyOfRow, termOrder,
    baseCreditSum, baseCreditSplit, advCreditSum, externalCreditSum, langCreditSum,
    calcCreditsForSummary, getAverageStats, guardCrossCaps, currentCapWarnMsg,
    getAllTakenCoursesForExam, computeJudgeEligibility, computeLawyerEligibility,
    isCrossProgramByProgramName, removeCourseById, clearTrack
} from './logic.js';

// --- DOM Helper ---
const $ = (id) => document.getElementById(id);

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

// --- Render Components ---

function nameWithBadgeScreen(row) {
    const label = row?.isTransfer ? "抵免" : (row?.track === "base" ? "基礎" : (row?.track === "adv" ? "進階" : "課程"));
    let cls = "bg-slate-50 text-slate-700 border-slate-200";
    if (label === "抵免") cls = "bg-amber-50 text-amber-800 border-amber-200";
    else if (label === "基礎") cls = "bg-sky-50 text-sky-700 border-sky-200";
    else if (label === "進階") cls = "bg-indigo-50 text-indigo-700 border-indigo-200";

    const badge = `<span class="inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold shrink-0 ${cls}">${esc(label)}</span>`;
    
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

function renderStudentIdOptions() {
    const elId = $("studentId");
    if (!elId) return;
    const opts = [`<option value="">1～70</option>`];
    for (let i = 1; i <= 70; i++) {
        const v = pad2(i);
        opts.push(`<option value="${v}">${i}</option>`);
    }
    elId.innerHTML = opts.join("");
    
    const full = String(state.studentId || "").trim();
    const suffix = full.match(/(\d{2})$/)?.[1] || "";
    if (suffix) elId.value = suffix;
}

function renderTermOptionsFromCourses() {
    const pickTerm = $("pickTerm");
    const extTerm = $("extTerm");
    const avgTermPick = $("avgTermPick");
    if (!pickTerm) return;

    const current = pickTerm.value;
    let terms = Array.from(new Set(allCourses.map(termOfCourse).filter(Boolean)))
        .filter(t => /^\d{3}[12]$/.test(String(t)));

    if (!terms.length) {
        const y = String(getAdmissionYear()).slice(0, 3);
        terms = [`${y}1`, `${y}2`];
    }

    terms.sort((a, b) => {
        const ya = String(a).slice(0, 3);
        const yb = String(b).slice(0, 3);
        if (ya !== yb) return ya.localeCompare(yb, "zh-Hant");
        return a.slice(3) - b.slice(3);
    });

    const html = terms.map(t => `<option value="${esc(t)}">${esc(termToLabel(t))}</option>`).join("");
    
    pickTerm.innerHTML = html;
    if (extTerm) extTerm.innerHTML = html;
    if (avgTermPick) avgTermPick.innerHTML = html;

    if (current && terms.includes(current)) pickTerm.value = current;
    else pickTerm.value = terms[terms.length - 1] || "";
    
    if (extTerm) extTerm.value = pickTerm.value;
    if (avgTermPick && state.avgTerm) avgTermPick.value = state.avgTerm;
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
        pickCourseList.innerHTML = `<div class="p-3 text-sm text-rose-600">${esc(systemStatus.coursesError || "載入中...")}</div>`;
        return;
    }

    const term = pickTerm.value;
    const prog = pickProgram.value;
    const isLLM = prog === "法碩專班";
    const isGrad = prog === "法科所" || prog === "法律系碩士班";

    if ($("levelWrap")) $("levelWrap").classList.toggle("hidden", !isLLM);
    if ($("langWrap")) $("langWrap").classList.toggle("hidden", !isGrad);

    if (isLLM) {
        const allowSummer = /^\d{3}1$/.test(term);
        const SUMMER_VAL = "summer_adv";
        let opt = Array.from(pickLevel.options).find(o => o.value === SUMMER_VAL);
        if (allowSummer && !opt) {
            opt = document.createElement("option");
            opt.value = SUMMER_VAL;
            opt.textContent = "暑修課程(進階)";
            const advOpt = Array.from(pickLevel.options).find(o => o.value === "adv");
            if(advOpt) pickLevel.insertBefore(opt, advOpt.nextSibling);
            else pickLevel.appendChild(opt);
        } else if (!allowSummer && opt) {
            opt.remove();
            if (pickLevel.value === SUMMER_VAL) pickLevel.value = "adv";
        }
    }

    const level = isLLM ? (pickLevel?.value || "adv") : "adv";
    const langLevel = isGrad ? (pickLangLevel?.value || "normal") : "normal";
    const selectedYear = String(term || '').slice(0, 3);

    const pickedRefIds = new Set();
    [...state.base, ...state.adv].forEach(r => { if (r.courseRefId) pickedRefIds.add(Number(r.courseRefId)); });

    const list = allCourses
        .filter(c => c.program === prog)
        .filter(c => {
            if (pickedRefIds.has(Number(c.id))) return false;
            if (isLLM) {
                if (level === "summer_adv") return c.isSmr === true && yearOfCourse(c) === selectedYear;
                if (c.isSmr === true) return false;
                if (termOfCourse(c) !== term) return false;
                return level === "base" ? !!c.isBase : !c.isBase;
            }
            if (termOfCourse(c) !== term) return false;
            if (isGrad) return langLevel === "lang" ? !!c.isLang : !c.isLang;
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
                        (teacher ? `｜老師：${teacher}` : "") + (code ? `｜${code}` : "");
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
        if (!sourceFilter) return true;
        return r.source === sourceFilter;
    });
    if (!rows.length) {
        tbody.innerHTML = `<tr><td class="px-3 py-4 text-slate-500" colspan="6">無資料。</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        ${!sourceFilter ? `<td class="px-3 py-2">${r.source==='creditClass'?'學分班':'學校學分'}</td>` : ''}
        <td class="px-3 py-2">${esc(r.school || "")}</td>
        <td class="px-3 py-2">${esc(r.name || "")}</td>
        <td class="px-3 py-2 mono">${esc(r.credit)}</td>
        <td class="px-3 py-2">
            <input type="number" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 mono"
            data-s="externalCredits" data-i="${r._idx}" data-k="grade" value="${esc(r.grade||"")}">
        </td>
        <td class="px-3 py-2">
            <button type="button" class="px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm hover:bg-slate-50"
            data-act="${actName}" data-i="${r._idx}">刪除</button>
        </td>
      </tr>
    `).join("");
}

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

function refreshStats() {
    const { avg, sumC, count } = getAverageStats();
    if ($("avgScore")) $("avgScore").textContent = avg ? avg.toFixed(2) : "—";
    if ($("avgCredits")) $("avgCredits").textContent = String(sumC);
    if ($("avgCourses")) $("avgCourses").textContent = String(count);

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

    const summary = calcCreditsForSummary();
    if ($("creditLLMAdv")) $("creditLLMAdv").textContent = String(summary.llmAdv);
    if ($("creditTechNonLang")) $("creditTechNonLang").textContent = String(summary.techNonLang);
    if ($("creditLawNonLang")) $("creditLawNonLang").textContent = String(summary.lawNonLang);
    if ($("creditExternalNonLang")) $("creditExternalNonLang").textContent = String(summary.externalNonLang);
    if ($("creditLangTotal")) $("creditLangTotal").textContent = String(summary.langTotal);
    if ($("creditTransferAdv")) $("creditTransferAdv").textContent = String(summary.transferAdv);
    if ($("creditGrandTotal")) $("creditGrandTotal").textContent = String(summary.grandTotal);

    const total = bTotal + summary.grandTotal;
    if ($("creditsTotal")) $("creditsTotal").textContent = String(total);
    
    const remEl = $("ring-rem"), baseEl = $("ring-base"), advEl = $("ring-adv"), totalEl = $("ring-total");
    if (remEl && baseEl && advEl) {
        const r = 46, C = 2 * Math.PI * r, T = 54;
        const b = Math.min(bTotal, T);
        const a = Math.min(summary.grandTotal, T - b);
        const bLen = (b/T) * C, aLen = (a/T) * C;
        remEl.style.strokeDasharray = `${C} 0`;
        baseEl.style.strokeDasharray = `${bLen} ${Math.max(0, C - bLen)}`;
        advEl.style.strokeDasharray = `${aLen} ${Math.max(0, C - aLen)}`;
        advEl.style.strokeDashoffset = `${-bLen}`;
        if(totalEl) totalEl.textContent = String(Math.round(total));
    }

    const advWarn = $("advWarn");
    if (advWarn) {
        let msg = "";
        if (!state.eligibleExempt && advCreditSum() < 18) msg += "進階課程未達 18 學分。";
        if (currentCapWarnMsg) msg += "\n" + currentCapWarnMsg;
        advWarn.classList.toggle("hidden", !msg);
        advWarn.textContent = msg;
    }
}

function refreshExamAnalysisUI() {
    if (!state.showExamAnalysis || state.eligibleExempt) {
        if ($("examAnalysis")) $("examAnalysis").classList.add("hidden");
        return;
    }
    if ($("examAnalysis")) $("examAnalysis").classList.remove("hidden");

    const courses = getAllTakenCoursesForExam();
    const j = computeJudgeEligibility(courses);
    const l = computeLawyerEligibility(courses);

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
    if ($("lawyerResult")) {
        $("lawyerResult").textContent = l.pass ? "✅ 目前符合" : "⚠ 未達門檻";
        $("lawyerResult").className = l.pass ? "px-2 py-1 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-800" : "px-2 py-1 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800";
    }
    if ($("lawyerDetails")) {
        $("lawyerDetails").innerHTML = `
            <div class="mb-2 font-semibold">必含科目：${l.mustOk ? "✅ 符合" : "❌ 未符合"}</div>
            <div class="text-xs text-slate-700">民法(${l.civil.ok?"OK":"NO"})、刑法(${l.criminal.ok?"OK":"NO"})、訴訟法(${l.mustOk && (l.ms.counted||l.xs.counted) ? "OK":"NO"})</div>
            <div class="mt-2 font-semibold">總學分：${l.totalCountedCredits} / 20</div>
            <div class="font-semibold">總學科：${l.disciplineCount} / 7</div>
        `;
    }
}

function initExternalDeptDropdown() {
    const sel = $("extDept");
    if (!sel || !externalDeptMapByCode) return;
    if (sel.tagName !== "SELECT") {
        const newSel = document.createElement("select");
        newSel.id = sel.id; newSel.className = sel.className;
        sel.parentNode.replaceChild(newSel, sel);
    }
    const grouped = {};
    for (const [code, val] of externalDeptMapByCode.entries()) {
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

// --- Interaction Actions ---

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

    if (addedCount > 0) { save(); renderAll(); } else { alert("未新增課程 (可能已存在)。"); }
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
    save(); renderAll();
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
    save(); renderAll();
}

// --- Print Logic (Complex A4 Paging) ---

function mmToPx(mm) {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:-9999px;height:${mm}mm;width:1mm;`;
    document.body.appendChild(d);
    const px = d.getBoundingClientRect().height;
    d.remove();
    return px;
}

function htmlRowsToCells(rowsHtml, colCount) {
    const tmp = document.createElement("tbody");
    tmp.innerHTML = rowsHtml;
    return Array.from(tmp.querySelectorAll("tr")).map((tr) => {
      const tds = Array.from(tr.querySelectorAll("td")).map((td) => `<td>${td.innerHTML}</td>`);
      while (tds.length < colCount) tds.push("<td>&nbsp;</td>");
      return tds.slice(0, colCount);
    });
}

function __buildMergedRowTrHtml(leftCells, rightCells, leftCols, rightCols) {
    const L = leftCells || Array(leftCols).fill("<td>&nbsp;</td>");
    const R = rightCells || Array(rightCols).fill("<td>&nbsp;</td>");
    return `<tr>${L.join("")}${R.join("")}</tr>`;
}

function __buildMergedTrList(leftRowsHtml, leftCols, rightRowsHtml, rightCols) {
    const left = htmlRowsToCells(leftRowsHtml, leftCols);
    const right = htmlRowsToCells(rightRowsHtml, rightCols);
    const maxRows = Math.max(left.length, right.length);
    const merged = [];
    for (let i = 0; i < maxRows; i++) {
        merged.push(__buildMergedRowTrHtml(left[i], right[i], leftCols, rightCols));
    }
    return merged;
}

function mergeTwoColumnsRowsPaged(leftRowsHtml, leftCols, rightRowsHtml, rightCols, noteLine, summaryHtml = "", showMeta = true) {
    const SAFETY_PX = mmToPx(10);
    const mergedTrs = __buildMergedTrList(leftRowsHtml, leftCols, rightRowsHtml, rightCols);
    const PRINT_TITLE = "國立政治大學法學院碩士在職專班課程自我檢核表";
    const titleHtml = `<div class="print-title"><div class="l4">${PRINT_TITLE}</div></div>`;
    
    const colgroupHtml = (leftCols === 5 && rightCols === 5) ? `
      <colgroup>
        <col style="width:21%"><col style="width:15%"><col style="width:4%"><col style="width:6%"><col style="width:4%">
        <col style="width:21%"><col style="width:15%"><col style="width:4%"><col style="width:6%"><col style="width:4%">
      </colgroup>` : '';

    const metaHtmlFull = `
      <div class="print-meta">
        <div class="meta-row"><span class="label">姓名：</span><span class="fill">${esc(state.studentName)}</span></div>
        <div class="meta-row"><span class="label">學號：</span><span class="fill">${esc(state.studentId)}</span></div>
        <div class="meta-row full"><span class="label">備註：</span><span class="fill">${esc(noteLine || "")}</span></div>
      </div>`;

    const metaPolicy = showMeta === "first" ? "first" : showMeta ? "all" : "none";
    const metaForPage = (p) => metaPolicy === "all" || (metaPolicy === "first" && p === 0) ? metaHtmlFull : "";

    // Empty Case
    if (!mergedTrs.length) {
        const pageHtml = `
          <div class="print-page">
            <div class="print-box">
              ${titleHtml}${metaForPage(0)}
              <table class="print-table">${colgroupHtml}
                <thead>
                  <tr><th colspan="${leftCols}">基礎課程</th><th colspan="${rightCols}">進階課程（含外院）</th></tr>
                  <tr><th>課程名稱</th><th>課程代碼/<br>系所</th><th>學分</th><th>成績</th><th>核對</th><th>課程名稱</th><th>課程代碼/<br>系所</th><th>學分</th><th>成績</th><th>核對</th></tr>
                </thead>
                <tbody><tr><td colspan="${leftCols + rightCols}">&nbsp;</td></tr></tbody>
              </table>
            </div>
          </div>`;
        return pageHtml + (summaryHtml ? `<div class="print-page print-break"><div class="print-box">${titleHtml}<div class="print-summary-wrap">${summaryHtml}</div></div></div>` : "");
    }

    // Measurement
    const PAGE_CONTENT_H_PX = mmToPx(262);
    const measureWrap = document.createElement("div");
    measureWrap.style.cssText = "position:fixed;left:-99999px;top:0;width:210mm;height:297mm;overflow:hidden;background:white;";
    document.body.appendChild(measureWrap);
    
    measureWrap.innerHTML = `
      <div class="print-page" style="width:210mm; height:297mm;">
        <div class="print-box">
          ${titleHtml}${metaHtmlFull}
          <table class="print-table">${colgroupHtml}
            <thead>
              <tr><th colspan="${leftCols}">基礎課程</th><th colspan="${rightCols}">進階課程（含外院）</th></tr>
              <tr><th>課程名稱</th><th>課程代碼/系所</th><th>學分</th><th>成績</th><th>核對</th><th>課程名稱</th><th>課程代碼/系所</th><th>學分</th><th>成績</th><th>核對</th></tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>`;

    const box = measureWrap.querySelector(".print-box");
    const theadH = measureWrap.querySelector(".print-table thead").getBoundingClientRect().height || 0;
    const titleH = box.querySelector(".print-title").getBoundingClientRect().height || 0;
    const metaH = box.querySelector(".print-meta").getBoundingClientRect().height || 0;
    const tbody = measureWrap.querySelector(".print-table tbody");

    const fixedFirst = titleH + metaH + theadH;
    const fixedOther = titleH + theadH; // No meta on subsequent pages if "first"
    
    // Calculate max height for tbody
    const MAX_TBODY_H_FIRST = Math.max(60, PAGE_CONTENT_H_PX - fixedFirst - 6 - SAFETY_PX);
    const MAX_TBODY_H_OTHER = Math.max(60, PAGE_CONTENT_H_PX - fixedOther - 6 - SAFETY_PX);

    const pages = [];
    let curRows = [];
    let curMax = MAX_TBODY_H_FIRST;

    const flush = () => {
        pages.push({ rows: curRows, maxTbodyH: curMax });
        curRows = [];
    };

    for (let i = 0; i < mergedTrs.length; i++) {
        const trHtml = mergedTrs[i];
        tbody.insertAdjacentHTML("beforeend", trHtml);
        const h = tbody.getBoundingClientRect().height || 0;

        if (h <= curMax) {
            curRows.push(trHtml);
        } else {
            // Remove last added
            tbody.lastElementChild.remove();
            if (!curRows.length) { curRows.push(trHtml); flush(); tbody.innerHTML=""; curMax = MAX_TBODY_H_OTHER; continue; }
            
            flush();
            tbody.innerHTML = "";
            curMax = MAX_TBODY_H_OTHER; // Next pages might have different header height
            tbody.insertAdjacentHTML("beforeend", trHtml);
            curRows.push(trHtml);
        }
    }
    if (curRows.length) flush();

    // Summary logic
    let attachSummaryToLast = false;
    const summaryTrim = String(summaryHtml || "").trim();
    if (summaryTrim && pages.length) {
        const last = pages[pages.length - 1];
        tbody.innerHTML = last.rows.join("");
        const tbodyH = tbody.getBoundingClientRect().height || 0;
        const remain = Math.max(0, last.maxTbodyH - tbodyH - 10);
        
        const sm = document.createElement("div");
        sm.className = "print-summary-wrap";
        sm.innerHTML = summaryHtml;
        box.appendChild(sm);
        const smH = sm.getBoundingClientRect().height || 0;
        sm.remove();
        
        attachSummaryToLast = smH <= remain;
    }
    measureWrap.remove();

    // Generate Output HTML
    const lastIdx = pages.length - 1;
    const out = pages.map((pg, p) => {
        const breakCls = p > 0 ? "print-break" : "";
        const metaHtml = metaForPage(p);
        const summaryPart = (attachSummaryToLast && p === lastIdx) ? `<div class="print-summary-wrap">${summaryHtml}</div>` : "";
        
        return `
          <div class="print-page ${breakCls}">
            <div class="print-box">
              ${titleHtml}${metaHtml}
              <table class="print-table">${colgroupHtml}
                <thead>
                  <tr><th colspan="${leftCols}">基礎課程</th><th colspan="${rightCols}">進階課程（含外院）</th></tr>
                  <tr><th>課程名稱</th><th>課程代碼/系所</th><th>學分</th><th>成績</th><th>核對</th><th>課程名稱</th><th>課程代碼/系所</th><th>學分</th><th>成績</th><th>核對</th></tr>
                </thead>
                <tbody>${pg.rows.join("")}</tbody>
              </table>
              ${summaryPart}
            </div>
          </div>`;
    }).join("");

    if (summaryTrim && !attachSummaryToLast) {
        return out + `<div class="print-page print-break"><div class="print-box">${titleHtml}<div class="print-summary-wrap">${summaryHtml}</div></div></div>`;
    }
    return out;
}

function buildPrintHtml() {
    // Data Prep
    const noteParts = [];
    if (state.note) noteParts.push(state.note);
    if (state.eligibleExempt) {
        const pieces = [];
        if (state.eligibleType === "degree" && state.eligibleDegree) {
            const label = CONSTANTS.ELIGIBLE_DEGREE_OPTIONS?.[state.eligibleDegree] || "";
            pieces.push(label ? `${state.eligibleDegree}：${label}` : state.eligibleDegree);
        }
        if (state.eligibleType === "credential" && state.eligibleCredential) pieces.push(state.eligibleCredential);
        if (pieces.length) noteParts.push(`畢業學校：${pieces.join("；")}`);
    }
    const noteLine = noteParts.join("；");

    // Sorting Helpers
    const __stripStatusSuffix = (s) => String(s || "").replace(/[（(](已修|預計)[）)]\s*$/u, "").trim();
    const __stripTermPrefix = (s) => String(s || "").replace(/^\d{3}-(?:1|2)\s+/u, "").replace(/^\d{3}\s*暑修\s*/u, "").replace(/^\d{3}S\s+/iu, "").trim();
    const __rowTermForPrint = (r) => String(r?.term || "").trim(); // Simplified, assumes term is normalized
    
    const __printName = (r) => {
        if (r?.isTransfer) {
            const ay = getAdmissionYear();
            const nm = __stripTermPrefix(__stripStatusSuffix(String(r?.name || "")));
            return `${ay} ${nm}（抵免）`.trim();
        }
        const t = __rowTermForPrint(r);
        const label = t ? termToLabel(t) : "";
        let nm = __stripTermPrefix(__stripStatusSuffix(String(r?.name || "")));
        if (label) {
            const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            nm = nm.replace(new RegExp(`^${escRe(label)}\\s+`, "u"), "").trim();
            return `${label} ${nm}`.trim();
        }
        return `${label} ${nm}`.trim();
    };
    
    const __codeDept = (r) => {
        const code = String(r?.code || "").trim();
        const dep = String(r?.dept || "").replace(/法學院\s*/g, "").trim();
        return dep ? `${code}/${dep}` : code;
    };
    const __gradeCell = (r) => (normalizeStatus(r?.status) === "planned") ? "預計" : (r?.grade ? r.grade : "已修");
    const __hasRowData = (r) => !!String(r?.name || "").trim();

    const __sortedForPrint = (arr) => {
        return (arr || []).filter(__hasRowData).sort((a, b) => {
            const oa = termOrder(termKeyOfRow(a));
            const ob = termOrder(termKeyOfRow(b));
            if (oa !== ob) return oa - ob;
            const sa = statusRank(normalizeStatus(a?.status));
            const sb = statusRank(normalizeStatus(b?.status));
            if (sa !== sb) return sa - sb;
            return (__printName(a)).localeCompare(__printName(b), "zh-Hant");
        });
    };

    const baseRows = __sortedForPrint(state.base).map(r => 
        `<tr><td>${esc(__printName(r))}</td><td class="mono">${esc(__codeDept(r))}</td><td class="center mono">${esc(r.credit)}</td><td class="center mono">${esc(__gradeCell(r))}</td><td class="center"><span class="chk"></span></td></tr>`
    );
    const advRows = __sortedForPrint(state.adv).map(r => 
        `<tr><td>${esc(__printName(r))}</td><td class="mono">${esc(__codeDept(r))}</td><td class="center mono">${esc(r.credit)}</td><td class="center mono">${esc(__gradeCell(r))}</td><td class="center"><span class="chk"></span></td></tr>`
    );

    // Summary Calculations
    const pickTerm = $("pickTerm");
    const focusTerm = String(pickTerm?.value || state.avgTerm || '').trim();
    const focusLabel = termToLabel(focusTerm);
    
    const isDone = (r) => normalizeStatus(r?.status) === "done";
    const isPlanned = (r) => normalizeStatus(r?.status) === "planned";
    const isFocusTerm = (r) => termKeyOfRow(r) === focusTerm;
    
    const sumCredits = (rows) => (rows || []).reduce((s, r) => s + toNum(r?.credit), 0);
    const countRows = (rows) => (rows || []).filter(__hasRowData).length;
    
    const baseDone = state.base.filter(isDone);
    const advDone = state.adv.filter(isDone);
    const basePlannedTerm = state.base.filter(r => isPlanned(r) && isFocusTerm(r));
    const advPlannedTerm = state.adv.filter(r => isPlanned(r) && isFocusTerm(r));
    
    const baseDoneSplit = baseCreditSplit(); // Re-using global logic might need adjustment if specific to rows, but logic.js handles state
    // Re-implement simplified split for specific row sets for the summary
    const _splitBase = (rows) => ({ 
        total: rows.reduce((s,r)=>s+toNum(r.credit),0), 
        transfer: rows.filter(r=>r.isTransfer).reduce((s,r)=>s+toNum(r.credit),0) 
    });
    const _splitAdv = (rows) => {
        let res = { llmAdv:0, techNonLang:0, lawNonLang:0, langTotal:0, externalNonLang:0, transferAdv:0, grandTotal:0 };
        rows.forEach(r => {
            const c = toNum(r.credit);
            if(c<=0) return;
            if(r.source==='transfer'||r.program==='抵免') { res.transferAdv+=c; }
            else if(r.source==='external'||r.program==='外院') { res.externalNonLang+=c; }
            else if(r.isLang) { res.langTotal+=c; }
            else if(r.program==='法科所') { res.techNonLang+=c; }
            else if(r.program==='法律系碩士班') { res.lawNonLang+=c; }
            else { res.llmAdv+=c; }
        });
        res.grandTotal = Object.values(res).reduce((a,b)=>a+b,0);
        return res;
    };

    const bDS = _splitBase(baseDone);
    const bPS = _splitBase(basePlannedTerm);
    const aDS = _splitAdv(advDone);
    const aPS = _splitAdv(advPlannedTerm);
    
    const earnedTotal = bDS.total + aDS.grandTotal;
    const plannedTotal = bPS.total + aPS.grandTotal;
    const projectedTotal = earnedTotal + plannedTotal;
    const earnedRemain = Math.max(0, CONSTANTS.GRAD_CREDITS - earnedTotal);
    const projectedRemain = Math.max(0, CONSTANTS.GRAD_CREDITS - projectedTotal);
    
    const extCapWarn = (aDS.externalNonLang + aPS.externalNonLang) >= CONSTANTS.CAP_EXTERNAL ? ` <span style="font-weight:700;">（已滿 ${CONSTANTS.CAP_EXTERNAL} 上限）</span>` : "";
    const langCapWarn = (aDS.langTotal + aPS.langTotal) >= CONSTANTS.CAP_LANG ? ` <span style="font-weight:700;">（已滿 ${CONSTANTS.CAP_LANG} 上限）</span>` : "";
    const externalCountedEarned = Math.min(aDS.externalNonLang, CONSTANTS.CAP_EXTERNAL);
    const externalCountedPlan = Math.min(aPS.externalNonLang, CONSTANTS.CAP_EXTERNAL);
    
    const lineIf = (l, v, s='學分', e='') => toNum(v)>0 ? `<div>${esc(l)}：${esc(String(v))}${esc(s)}${e}</div>` : '';
    
    const summaryHtml = `
      <div style="margin-top:4mm; border-top:1px solid #000; padding-top:3mm; font-size:10.5pt; line-height:1.55;">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:10mm; margin-bottom:2mm;">
          <div style="font-weight:700;">學分摘要</div>
          <div style="text-align:right; display:grid; justify-items:end; row-gap:1mm;">
            <div style="font-weight:700;">畢業總學分：${CONSTANTS.GRAD_CREDITS} 學分</div>
            <div>目前累積（已修）：${earnedTotal}｜尚差：${earnedRemain} 學分</div>
            ${plannedTotal > 0 ? `<div>含「${esc(focusLabel)}」預計後：${projectedTotal}｜尚差：${projectedRemain} 學分</div>` : ''}
          </div>
        </div>
        <div style="display:flex; gap:12mm; flex-wrap:wrap;">
          <div style="min-width:280px;">
            <div style="font-weight:700; margin-bottom:1mm;">A. 基礎／進階總覽</div>
            ${earnedTotal>0 ? `
                <div style="font-weight:700; margin-top:1mm;">（已修）</div>
                ${lineIf('基礎課程', bDS.total, '學分', bDS.transfer>0?`（其中抵免：${bDS.transfer}）`:'')}
                ${lineIf('進階課程', aDS.grandTotal, '學分', aDS.transferAdv>0?`（其中抵免：${aDS.transferAdv}）`:'')}
                ${lineIf('可計入畢業總學分', earnedTotal, '學分')}
            ` : '<div>—</div>'}
            ${plannedTotal>0 ? `
                <div style="font-weight:700; margin-top:2mm;">（${esc(focusLabel)} 預計）</div>
                ${lineIf('基礎課程', bPS.total)}
                ${lineIf('進階課程', aPS.grandTotal)}
                ${lineIf('本學期預計取得', plannedTotal, '學分')}
            ` : ''}
          </div>
          <div style="min-width:280px;">
            <div style="font-weight:700; margin-bottom:1mm;">B. 進階學分拆項</div>
            ${aDS.grandTotal>0 ? `
                <div style="font-weight:700; margin-top:1mm;">（已修）</div>
                ${lineIf('法碩專班', aDS.llmAdv)}
                ${lineIf('法科所', aDS.techNonLang)}
                ${lineIf('法律系碩士班', aDS.lawNonLang)}
                ${aDS.langTotal>0 ? `<div>語文課程：${aDS.langTotal}${langCapWarn}</div>` : ''}
                ${aDS.externalNonLang>0 ? `<div>外院學分：${aDS.externalNonLang}（認列：${externalCountedEarned}）${extCapWarn}</div>` : ''}
                ${lineIf('抵免課程', aDS.transferAdv)}
            ` : '<div>—</div>'}
            ${aPS.grandTotal>0 ? `
                <div style="font-weight:700; margin-top:2mm;">（${esc(focusLabel)} 預計）</div>
                ${lineIf('法碩專班', aPS.llmAdv)}
                ${lineIf('法科所', aPS.techNonLang)}
                ${lineIf('法律系碩士班', aPS.lawNonLang)}
                ${aPS.langTotal>0 ? `<div>語文課程：${aPS.langTotal}${langCapWarn}</div>` : ''}
                ${aPS.externalNonLang>0 ? `<div>外院學分：${aPS.externalNonLang}（認列：${externalCountedPlan}）${extCapWarn}</div>` : ''}
            ` : ''}
          </div>
        </div>
      </div>
    `;

    const printCss = `
      <style>
        .print-table { width:100%; border-collapse:collapse; table-layout:fixed; }
        .print-table th, .print-table td { border:1px solid #000; vertical-align:middle; padding:2px 4px; font-size:10.5pt; }
        .print-table th { background:#f8fafc; text-align:center; padding:4px; }
        .print-table td.center { text-align:center; }
        .print-table td.mono { font-family:monospace; }
        .chk { display:inline-block; width:12px; height:12px; border:1px solid #000; }
        @media print {
          .print-page { width:210mm !important; min-height:297mm !important; break-after:page; page-break-after:always; }
          .print-break { break-before:page; page-break-before:always; }
          .print-table tr, .print-summary-wrap { break-inside:avoid; page-break-inside:avoid; }
          .print-table thead { display:table-header-group; }
        }
      </style>`;

    return printCss + mergeTwoColumnsRowsPaged(baseRows, 5, advRows, 5, noteLine, summaryHtml, "first");
}

// --- Main Exports ---

export function renderAll() {
    renderStudentIdOptions(); // 🔴 補上這行，修復學號下拉

    if ($("studentName")) $("studentName").value = state.studentName;
    if ($("note")) $("note").value = state.note;
    if ($("studentId")) {
        const m = state.studentId.match(/9610(\d{2})$/);
        if (m) $("studentId").value = m[1]; 
    }
    
    if ($("eligibleExempt")) $("eligibleExempt").checked = state.eligibleExempt;
    if ($("eligibleBox")) $("eligibleBox").classList.toggle("hidden", !state.eligibleExempt);
    if ($("creditTransferEligible")) $("creditTransferEligible").checked = state.creditTransferEligible;
    if ($("transferAddWrap")) $("transferAddWrap").classList.toggle("hidden", !state.creditTransferEligible);

    renderTermOptionsFromCourses();
    renderCoursePicker();
    renderFullCourseList();
    renderTable("baseTbody", state.base, "base");
    renderTable("advTbody", state.adv, "adv");

    renderExternalCreditsList("ccTbody", "creditClass", "delCreditClass");
    renderExternalCreditsList("examExtTbody", "schoolCredit", "delExamExt");
    renderExternalCreditsList("externalCreditsTbody", null, "delExternalCredit");

    refreshStats();
    refreshExamAnalysisUI();

    if ($("externalAddWrap")) $("externalAddWrap").classList.toggle("hidden", !state.eligibleExempt || !state.externalCourseEnabled);
    if ($("externalCourseEnabled")) $("externalCourseEnabled").checked = state.externalCourseEnabled;
    
    if ($("trNameBase")) {
        const opts = [`<option value="">(請選擇)</option>`, ...Base_CLASS_SUBJECTS_114.map(s=>`<option value="${s}">${s}</option>`)];
        $("trNameBase").innerHTML = opts.join("");
    }
}

export function bindEvents() {
    document.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-act]");
        if (!btn) return;
        const act = btn.getAttribute("data-act");
        const idx = Number(btn.getAttribute("data-i"));

        if (act === "delBase") {
            const r = state.base[idx];
            if(r) removeCourseById(r.id);
            state.base.splice(idx, 1);
        } else if (act === "delAdv") {
            const r = state.adv[idx];
            if(r) removeCourseById(r.id);
            state.adv.splice(idx, 1);
        } else if (act === "delCreditClass" || act === "delExamExt" || act === "delExternalCredit") {
            state.externalCredits.splice(idx, 1);
        }
        save(); renderAll();
    });

    const bindInput = (id, field) => {
        if ($(id)) $(id).addEventListener("input", (e) => { state[field] = e.target.value; save(); });
    };
    bindInput("studentName", "studentName");
    bindInput("note", "note");
    
    ["pickProgram", "pickTerm", "pickLevel", "pickLangLevel"].forEach(id => {
        if ($(id)) $(id).addEventListener("change", renderCoursePicker);
    });

    if ($("btnAddCourse")) $("btnAddCourse").addEventListener("click", addSelectedCourse);
    if ($("btnAddExternalToAdv")) $("btnAddExternalToAdv").addEventListener("click", addExternalToAdvanced);
    if ($("btnAddTransfer")) $("btnAddTransfer").addEventListener("click", addTransferCourse);

    if ($("studentId")) {
        $("studentId").addEventListener("change", (e) => {
            state.studentId = composeStudentIdFull();
            save();
        });
    }
    document.querySelectorAll('input[name="admissionYear"]').forEach(r => {
        r.addEventListener("change", () => { state.studentId = composeStudentIdFull(); save(); });
    });
    
    if ($("eligibleExempt")) $("eligibleExempt").addEventListener("change", (e) => {
        state.eligibleExempt = e.target.checked; save(); renderAll();
    });
    if ($("creditTransferEligible")) $("creditTransferEligible").addEventListener("change", (e) => {
        state.creditTransferEligible = e.target.checked; save(); renderAll();
    });
    if ($("externalCourseEnabled")) $("externalCourseEnabled").addEventListener("change", (e) => {
        state.externalCourseEnabled = e.target.checked; save(); renderAll();
    });
    if ($("showExamAnalysis")) $("showExamAnalysis").addEventListener("change", (e) => {
        state.showExamAnalysis = e.target.checked; save(); renderAll();
    });

    if ($("btnBuild")) $("btnBuild").addEventListener("click", () => {
        const html = buildPrintHtml();
        const win = window.open("", "_blank");
        if(win) { win.document.write(html); win.document.close(); win.print(); }
    });
    
    if ($("btnReset")) $("btnReset").addEventListener("click", () => {
        if(confirm("確定重置?")) {
            resetState();
            localStorage.removeItem(CONSTANTS.STORAGE_KEY);
            location.reload();
        }
    });

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
                save(); renderAll();
            }
        }
    });
    
    initExternalDeptDropdown();
    
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
