// ==========================================
// report.js (修正版開頭)
// ==========================================
import { state, CONSTANTS } from './store.js';

// 1. utils.js 只拿它有的
import { esc, toNum, termToLabel } from './utils.js';

// 2. 關鍵修正：termKeyOfRow, termOrder 改從 logic.js 拿
import { 
    normalizeStatus, statusRank, baseCreditSplit, 
    calcCreditsForSummary, getAverageStats,
    termKeyOfRow, termOrder // <--- 這裡一定要有
} from './logic.js';




// --- 以下程式碼保持不變 ---
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
    const fixedOther = titleH + theadH; 
    
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
            tbody.lastElementChild.remove();
            if (!curRows.length) { curRows.push(trHtml); flush(); tbody.innerHTML=""; curMax = MAX_TBODY_H_OTHER; continue; }
            
            flush();
            tbody.innerHTML = "";
            curMax = MAX_TBODY_H_OTHER; 
            tbody.insertAdjacentHTML("beforeend", trHtml);
            curRows.push(trHtml);
        }
    }
    if (curRows.length) flush();

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

export function buildPrintHtml(currentAdmissionYear = "114") {
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
    const __rowTermForPrint = (r) => String(r?.term || "").trim(); 
    
    const __printName = (r) => {
        if (r?.isTransfer) {
            const ay = currentAdmissionYear;
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
    const focusTerm = String(state.avgTerm || '').trim();
    const focusLabel = termToLabel(focusTerm);
    
    const isDone = (r) => normalizeStatus(r?.status) === "done";
    const isPlanned = (r) => normalizeStatus(r?.status) === "planned";
    const isFocusTerm = (r) => termKeyOfRow(r) === focusTerm;
    
    const baseDone = state.base.filter(isDone);
    const advDone = state.adv.filter(isDone);
    const basePlannedTerm = state.base.filter(r => isPlanned(r) && isFocusTerm(r));
    const advPlannedTerm = state.adv.filter(r => isPlanned(r) && isFocusTerm(r));
    
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
