// ==========================================
// view.js - 負責所有畫面渲染 (View Layer)
// ==========================================
import { state, allCourses, externalDeptMapByCode, CONSTANTS, systemStatus, Base_CLASS_SUBJECTS_114 } from './store.js';
import { BASE_SUBJECTS_MAP } from './config.js';
import { esc, toNum, termToLabel, termLabelForCourse, yearOfCourse, pad2 } from './utils.js';
import { 
    normalizeStatus, baseCreditSum, baseCreditSplit, advCreditSum, 
    calcCreditsForSummary, getAverageStats, currentCapWarnMsg,
    termOrder, termKeyOfRow
} from './logic.js';
import { computeJudgeEligibility, computeLawyerEligibility, getAllTakenCoursesForExam } from './exam.js';

// DOM Helper
export const $ = (id) => document.getElementById(id);

export function getAdmissionYear() {
    const el = document.querySelector('input[name="admissionYear"]:checked');
    // 如果用的是新版 select，就抓 select
    const sel = $("pickAdmissionYear");
    if(sel) return sel.value;
    
    return (el?.value || "114").trim();
}

export function renderAdmissionYearPicker() {
    const el = $("pickAdmissionYear");
    if (!el) return;

    if (el.options.length === (CONSTANTS.YEAR_END - CONSTANTS.YEAR_START + 1)) {
        if (el.value !== state.admissionYear) el.value = state.admissionYear;
        return;
    }

    const opts = [];
    for (let y = CONSTANTS.YEAR_START; y <= CONSTANTS.YEAR_END; y++) {
        const val = String(y);
        const sel = val === state.admissionYear ? "selected" : "";
        opts.push(`<option value="${val}" ${sel}>${val} 學年度</option>`);
    }
    el.innerHTML = opts.join("");
}

export function renderTransferBaseNamePicker() {
    const el = $("trNameBase");
    if (!el) return;

    const year = state.admissionYear || "114";
    const subjects = BASE_SUBJECTS_MAP[year] || BASE_SUBJECTS_MAP["default"];

    const opts = [`<option value="">(請選擇)</option>`];
    subjects.forEach(s => {
        opts.push(`<option value="${esc(s)}">${esc(s)}</option>`);
    });
    
    el.innerHTML = opts.join("");
}

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

// --- Render Functions ---

export function renderStudentIdOptions() {
    const elId = $("studentId");
    if (!elId) return;
    if (elId.options.length > 1) {
        const full = String(state.studentId || "").trim();
        const suffix = full.match(/(\d{2})$/)?.[1] || "";
        if (suffix && elId.value !== suffix) elId.value = suffix;
        return;
    }

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

export function renderTermOptionsFromCourses() {
    const pickTerm = $("pickTerm");
    const extTerm = $("extTerm");
    const avgTermPick = $("avgTermPick");
    if (!pickTerm) return;

    const current = pickTerm.value;
    let terms = Array.from(new Set(allCourses.map(c => {
        const idStr = String(c?.id ?? "");
        const y = idStr.slice(0, 3);
        const sem = idStr.slice(3, 4);
        return (y && sem) ? `${y}${sem}` : "";
    }).filter(Boolean))).filter(t => /^\d{3}[12]$/.test(String(t)));

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
    
    if (pickTerm.innerHTML.length < 10 || pickTerm.options.length !== terms.length) {
        pickTerm.innerHTML = html;
        if (extTerm) extTerm.innerHTML = html;
        if (avgTermPick) avgTermPick.innerHTML = html;
    
        if (current && terms.includes(current)) pickTerm.value = current;
        else pickTerm.value = terms[terms.length - 1] || "";
        
        if (extTerm) extTerm.value = pickTerm.value;
        if (avgTermPick && state.avgTerm) avgTermPick.value = state.avgTerm;
    }
}

export function renderCoursePicker() {
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
                if (level === "summer_adv") return c.isSmr === true && String(c.id).slice(0,3) === selectedYear;
                if (c.isSmr === true) return false;
                const cTerm = (String(c.id).slice(0,3) + String(c.id).slice(3,4));
                if (cTerm !== term) return false;
                return level === "base" ? !!c.isBase : !c.isBase;
            }
            const cTerm = (String(c.id).slice(0,3) + String(c.id).slice(3,4));
            if (cTerm !== term) return false;
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

export function renderTable(tbodyId, rows, type) {
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

export function renderExternalCreditsList(tbodyId, sourceFilter, actName) {
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

export function renderFullCourseList() {
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

export function refreshStats() {
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

export function refreshExamAnalysisUI() {
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

export function initExternalDeptDropdown() {
    const sel = $("extDept");
    if (!sel || !externalDeptMapByCode) return;
    if (sel.tagName !== "SELECT") {
        const newSel = document.createElement("select");
        newSel.id = sel.id; newSel.className = sel.className;
        sel.parentNode.replaceChild(newSel, sel);
    }
    if (sel.options.length > 1 && sel.innerHTML.includes("optgroup")) return;

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

// 🔴 主渲染函數
export function renderAll() {
    if ($("studentName")) $("studentName").value = state.studentName;
    if ($("note")) $("note").value = state.note;
    
    renderStudentIdOptions();
    
    if ($("eligibleExempt")) $("eligibleExempt").checked = state.eligibleExempt;
    if ($("eligibleBox")) $("eligibleBox").classList.toggle("hidden", !state.eligibleExempt);
    if ($("creditTransferEligible")) $("creditTransferEligible").checked = state.creditTransferEligible;
    if ($("transferAddWrap")) $("transferAddWrap").classList.toggle("hidden", !state.creditTransferEligible);

    renderTermOptionsFromCourses(); // 內部自己會呼叫 getAdmissionYear
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
    
    if ($("trNameBase") && $("trNameBase").options.length <= 1) {
        const opts = [`<option value="">(請選擇)</option>`, ...Base_CLASS_SUBJECTS_114.map(s=>`<option value="${s}">${s}</option>`)];
        $("trNameBase").innerHTML = opts.join("");
    }
    
    initExternalDeptDropdown();
}
