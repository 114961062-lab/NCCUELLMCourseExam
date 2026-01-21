// ==========================================
// exam-lawyer.js - 律師考試資格規則
// ==========================================
import { toNum } from './utils.js';
import { pickCountedByPriority, hasCivilQualified, hasCriminalQualified } from './exam-core.js';

export function computeLawyerEligibility(courses) {
    const civil = hasCivilQualified(courses);
    const crim = hasCriminalQualified(courses);
    const disciplines = [
        { key: "民事訴訟法", test: (n) => /民事訴訟法/.test(n) },
        { key: "商事法", test: (n) => /商事法/.test(n) },
        { key: "非訟事件法", test: (n) => /非訟事件法/.test(n) },
        { key: "仲裁法", test: (n) => /仲裁法/.test(n) },
        { key: "公證法", test: (n) => /公證法/.test(n) },
        { key: "強制執行法", test: (n) => /強制執行法/.test(n) },
        { key: "破產法", test: (n) => /破產法/.test(n) },
        { key: "國際私法", test: (n) => /國際私法/.test(n) },
        { key: "少年事件處理法", test: (n) => /少年事件處理法/.test(n) },
        { key: "刑事訴訟法", test: (n) => /刑事訴訟法/.test(n) },
        { key: "證據法", test: (n) => /證據法/.test(n) },
        { key: "行政法", test: (n) => /行政法/.test(n) || /行政救濟法/.test(n) },
        { key: "公司法", test: (n) => /公司法/.test(n) },
        { key: "海商法", test: (n) => /海商法/.test(n) },
        { key: "票據法", test: (n) => /票據法/.test(n) },
        { key: "保險法", test: (n) => /保險法/.test(n) },
        { key: "證券交易法", test: (n) => /證券交易法/.test(n) },
        { key: "土地法", test: (n) => /土地法/.test(n) },
        { key: "租稅法", test: (n) => /租稅法/.test(n) },
        { key: "公平交易法", test: (n) => /公平交易法/.test(n) },
        { key: "智慧財產權法", test: (n) => /智慧財產權法/.test(n) },
        { key: "著作權法", test: (n) => /著作權法/.test(n) },
        { key: "專利法", test: (n) => /專利/.test(n) },
        { key: "商標法", test: (n) => /商標法/.test(n) },
        { key: "消費者保護法", test: (n) => /消費者保護法/.test(n) },
        { key: "社會福利法", test: (n) => /社會福利法/.test(n) || /社會保險法/.test(n) },
        { key: "勞動法", test: (n) => /勞動法/.test(n) || /勞工法/.test(n) },
        { key: "環境法", test: (n) => /環境法/.test(n) || /環境保護法/.test(n) },
        { key: "國際公法", test: (n) => /國際公法/.test(n) },
        { key: "國際貿易法", test: (n) => /國際貿易法/.test(n) || /國際貿易與法律/.test(n) },
        { key: "英美契約法", test: (n) => /英美契約法/.test(n) },
        { key: "英美侵權行為法", test: (n) => /英美侵權行為法/.test(n) },
        { key: "法理學", test: (n) => /法理學/.test(n) },
        { key: "法學方法論", test: (n) => /法學方法論/.test(n) },
    ];

    const perDetail = disciplines.map((d) => {
        const hits = courses.filter((c) => d.test(c.name));
        const pickedInfo = pickCountedByPriority(hits, 3);
        return { key: d.key, rawSum: pickedInfo.rawSum, counted: pickedInfo.counted, picked: pickedInfo.picked };
    });

    const civilHits = courses.filter(c => /(民法總則|民法債編總論|民法債編各論|物權法|身分法)/.test(c.name) || (/民法/.test(c.name) && !/(民法總則|民法債編總論|民法債編各論|物權法|身分法)/.test(c.name)));
    const civilP = pickCountedByPriority(civilHits, 3);
    const civilCounted = civil.ok ? civilP.counted : 0;

    const crimHits = courses.filter(c => /(刑法總則|刑法分則)/.test(c.name) || /(^|\s)刑法(\s|$)|刑法專題研究|基礎刑法|進階刑法/.test(c.name));
    const crimP = pickCountedByPriority(crimHits, 3);
    const crimCounted = crim.ok ? crimP.counted : 0;

    const ms = perDetail.find(x => x.key === "民事訴訟法");
    const xs = perDetail.find(x => x.key === "刑事訴訟法");

    let disciplineCount = 0;
    let totalCountedCredits = 0;
    if (civil.ok) { disciplineCount++; totalCountedCredits += civilCounted; }
    if (crim.ok) { disciplineCount++; totalCountedCredits += crimCounted; }
    for (const x of perDetail) { if (x.counted > 0) { disciplineCount++; totalCountedCredits += x.counted; } }

    const mustOk = civil.ok && crim.ok && (ms.counted > 0 || xs.counted > 0);
    const pass = disciplineCount >= 7 && totalCountedCredits >= 20 && mustOk;

    return {
        pass, disciplineCount, totalCountedCredits, mustOk,
        civil: { ok: civil.ok, hits: civil.hits, raw: civilP.rawSum, counted: civilCounted, picked: civilP.picked },
        criminal: { ok: crim.ok, hasGen: crim.hasGen, hasSpe: crim.hasSpe, raw: crimP.rawSum, counted: crimCounted, picked: crimP.picked },
        ms, xs, perDetail
    };
}
