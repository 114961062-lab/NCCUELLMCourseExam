// ==========================================
// exam-judge.js - 司法官考試資格規則
// ==========================================
import { toNum } from './utils.js';
import { pickCountedByPriority, hasCivilQualified, hasCriminalQualified } from './exam-core.js';

export function computeJudgeEligibility(courses) {
    const civil = hasCivilQualified(courses);
    const crim = hasCriminalQualified(courses);
    const subjects = [
        { key: "憲法", test: (n) => /憲法/.test(n) },
        { key: "行政法", test: (n) => /行政法/.test(n) || /行政救濟法/.test(n) },
        { key: "民事訴訟法", test: (n) => /民事訴訟法/.test(n) },
        { key: "刑事訴訟法", test: (n) => /刑事訴訟法/.test(n) },
        { key: "商事法", test: (n) => /商事法/.test(n) || /公司法|票據法|保險法|海商法|證券交易法/.test(n) },
        { key: "民法", special: "civil" },
        { key: "刑法", special: "criminal" },
    ];

    const detail = [];
    let passCount = 0;
    let totalCountedCredits = 0;

    for (const s of subjects) {
        let ok = false;
        let used = [];
        let raw = 0;
        let counted = 0;

        if (s.special === "civil") {
            const hits = courses.filter(c => /(民法總則|民法債編總論|民法債編各論|物權法|身分法)/.test(c.name) || (/民法/.test(c.name) && !/(民法總則|民法債編總論|民法債編各論|物權法|身分法)/.test(c.name)));
            const p = pickCountedByPriority(hits, 3);
            raw = p.rawSum; ok = civil.ok; counted = ok ? p.counted : 0;
            used = ok ? [`已涵蓋：${civil.hits.join("、")}`, ...p.picked.map(h => `${h.name}(${h.credit})`)] : [`需五選三`];
        } else if (s.special === "criminal") {
            const hits = courses.filter(c => /(刑法總則|刑法分則)/.test(c.name) || /(^|\s)刑法(\s|$)|刑法專題研究|基礎刑法|進階刑法/.test(c.name));
            const p = pickCountedByPriority(hits, 3);
            raw = p.rawSum; ok = crim.ok; counted = ok ? p.counted : 0;
            used = [`總則:${crim.hasGen?"O":"X"} 分則:${crim.hasSpe?"O":"X"}`, ...p.picked.map(h => `${h.name}(${h.credit})`)];
        } else {
            const hits = courses.filter(c => s.test(c.name));
            const okHits = hits.filter(h => toNum(h.credit) >= 2);
            ok = okHits.length > 0;
            const p = pickCountedByPriority(ok ? okHits : hits, 3);
            raw = p.rawSum; counted = ok ? p.counted : 0;
            used = p.picked.length ? p.picked.map(h => `${h.name}(${h.credit})`) : ["—"];
        }
        if (ok) passCount++;
        totalCountedCredits += counted;
        detail.push({ subject: s.key, ok, raw, counted, used });
    }
    return { pass: passCount >= 2, passCount, totalCountedCredits, detail };
}
