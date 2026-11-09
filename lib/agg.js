// 반 전체 답을 모으고(보드·발표자 화면 공용) 단계별 현황을 센다.
import { K, hgetallJSON, hgetallMany } from './store.js';
import { srcLines } from '../public/assets/text.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const s = (v) => String(v ?? '').trim();

export async function collect() {
  const students = await hgetallJSON(K.students);
  const ids = Object.keys(students).sort((a, b) => (students[a]?.joinedAt || 0) - (students[b]?.joinedAt || 0));
  const rows = await hgetallMany(ids.map(K.resp));
  return { students, ids, rows };
}

export function progress(r) {
  return {
    p1: !!(s(r.p1?.sentence) && arr(r.p1?.lines).length),
    p1ai: arr(r.p1ai).length > 0,
    p1cmp: !!(r.p1cmp?.who || s(r.p1cmp?.word)),
    src: srcLines(r.src).length > 0,
    p2codes: arr(r.p2?.codes).some((c) => s(c.code)),
    p2: !!s(r.p2?.sentence),
    p2ai: arr(r.p2ai).length > 0,
    p2cmp: ['context', 'coding', 'verify', 'voice'].some((k) => r.p2cmp?.[k]),
  };
}

function tally(list) {
  const m = new Map();
  list.map(s).filter(Boolean).forEach((w) => m.set(w, (m.get(w) || 0) + 1));
  return [...m].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'ko'));
}

const emptyChecks = () => ({ me: 0, ai: 0, both: 0, none: 0 });

export function summarize(students, ids, rows, showNames) {
  const name = (id) => (showNames ? s(students[id]?.name) : '');
  const counts = { participants: ids.length, p1: 0, p1ai: 0, p1cmp: 0, src: 0, p2codes: 0, p2: 0, p2ai: 0, p2cmp: 0 };
  const p1 = { picks: {}, aiPicks: {}, pickers: 0, aiRuns: 0, words: [], who: emptyChecks(), human: [], ai: [] };
  const src = { extras: [] };
  const p2 = { coders: 0, aiRuns: 0, humanCodes: [], aiCodes: [], segs: [], checks: { context: emptyChecks(), coding: emptyChecks(), verify: emptyChecks(), voice: emptyChecks() }, remains: [], human: [], ai: [] };
  const words = [];
  const hCodes = [];
  const aCodes = [];
  const segs = new Map();
  const seg = (k) => segs.get(k) || segs.set(k, { seg: k, h: 0, a: 0 }).get(k);

  ids.forEach((id, i) => {
    const r = rows[i] || {};
    const pr = progress(r);
    Object.keys(pr).forEach((k) => { if (pr[k]) counts[k] += 1; });
    const who = name(id);

    if (arr(r.p1?.lines).length) p1.pickers += 1;
    arr(r.p1?.lines).forEach((k) => { p1.picks[k] = (p1.picks[k] || 0) + 1; });
    if (s(r.p1?.sentence)) p1.human.push({ text: s(r.p1.sentence), name: who });
    arr(r.p1ai).forEach((run) => {
      p1.aiRuns += 1;
      arr(run?.data?.lines).forEach((k) => { p1.aiPicks[k] = (p1.aiPicks[k] || 0) + 1; });
      if (s(run?.data?.sentence)) p1.ai.push({ text: s(run.data.sentence), name: who });
    });
    if (s(r.p1cmp?.word)) words.push(r.p1cmp.word);
    if (p1.who[r.p1cmp?.who] != null) p1.who[r.p1cmp.who] += 1;

    arr(r.src?.extras).filter((x) => s(x?.name) || s(x?.note)).forEach((x) => src.extras.push({ name: s(x.name), note: s(x.note), who }));

    if (arr(r.p2?.codes).length) p2.coders += 1;
    arr(r.p2?.codes).forEach((c) => {
      if (!c?.seg) return;
      seg(c.seg).h += 1;
      if (s(c.code)) hCodes.push(c.code);
    });
    if (s(r.p2?.sentence)) p2.human.push({ text: s(r.p2.sentence), name: who });
    arr(r.p2ai).forEach((run) => {
      p2.aiRuns += 1;
      arr(run?.data?.codes).forEach((c) => {
        if (!c?.seg) return;
        seg(c.seg).a += 1;
        if (s(c.code)) aCodes.push(c.code);
      });
      if (s(run?.data?.sentence)) p2.ai.push({ text: s(run.data.sentence), name: who });
    });
    for (const k of Object.keys(p2.checks)) {
      const v = r.p2cmp?.[k];
      if (p2.checks[k][v] != null) p2.checks[k][v] += 1;
    }
    if (s(r.p2cmp?.remain)) p2.remains.push({ text: s(r.p2cmp.remain), name: who });
  });

  p1.words = tally(words);
  p2.humanCodes = tally(hCodes);
  p2.aiCodes = tally(aCodes);
  p2.segs = [...segs.values()].sort((a, b) => (b.h + b.a) - (a.h + a.a) || b.h - a.h).slice(0, 6);
  return { counts, p1, src, p2 };
}

// 발표자 화면용: 사람마다 진행 상황과 답 (프롬프트 전문은 빼고)
export function people(students, ids, rows) {
  const lite = (runs) => arr(runs).map((x) => ({ data: x.data, ms: x.ms, at: x.at, model: x.model, withSrc: !!x.withSrc }));
  return ids.map((id, i) => {
    const r = rows[i] || {};
    return {
      id,
      name: s(students[id]?.name),
      joinedAt: students[id]?.joinedAt || 0,
      progress: progress(r),
      p1: r.p1 || null,
      p1ai: lite(r.p1ai),
      p1cmp: r.p1cmp || null,
      src: r.src || null,
      p2: r.p2 || null,
      p2ai: lite(r.p2ai),
      p2cmp: r.p2cmp || null,
    };
  });
}
