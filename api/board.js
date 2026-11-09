import { K, hgetallJSON, hgetallMany } from '../lib/store.js';
import { getConfig, send } from '../lib/util.js';

// 반 전체의 답을 모아 보드용으로 정리한다(기본은 이름 없이).
export default async function handler(req, res) {
  try {
    const cfg = await getConfig();
    const students = await hgetallJSON(K.students);
    const ids = Object.keys(students);
    const rows = await hgetallMany(ids.map(K.resp));
    const who = (id) => (cfg.showNames ? students[id]?.name || '' : '');

    const p1 = { human: [], ai: [], diffs: {} };
    const p2 = { human: [], ai: [], remain: { context: [], purpose: [], verify: [], expression: [] } };
    const counts = { participants: ids.length, p1: 0, p1ai: 0, p1diff: 0, p2: 0, p2ai: 0, p2cmp: 0 };

    ids.forEach((id, i) => {
      const r = rows[i] || {};
      const name = who(id);
      if (r.p1?.sentence) { p1.human.push({ text: r.p1.sentence, name, at: r.p1.at }); counts.p1++; }
      if (Array.isArray(r.p1ai) && r.p1ai.length) {
        counts.p1ai++;
        r.p1ai.forEach((a) => p1.ai.push({ text: a.one_sentence, name, at: a.at, run: a.run, model: a.model }));
      }
      if (r.p1diff?.word) {
        const w = r.p1diff.word.replace(/\s+/g, ' ').trim();
        p1.diffs[w] = (p1.diffs[w] || 0) + 1;
        counts.p1diff++;
      }
      if (r.p2?.sentence) { p2.human.push({ text: r.p2.sentence, name, rq: r.p2.rq, at: r.p2.at }); counts.p2++; }
      if (Array.isArray(r.p2ai) && r.p2ai.length) {
        counts.p2ai++;
        r.p2ai.forEach((a) => p2.ai.push({ text: a.one_sentence, name, at: a.at, run: a.run, model: a.model }));
      }
      if (r.p2cmp) {
        counts.p2cmp++;
        for (const k of Object.keys(p2.remain)) if (r.p2cmp[k]) p2.remain[k].push({ text: r.p2cmp[k], name, at: r.p2cmp.at });
      }
    });

    const byTime = (a, b) => (a.at || 0) - (b.at || 0);
    [p1.human, p1.ai, p2.human, p2.ai, ...Object.values(p2.remain)].forEach((l) => l.sort(byTime));
    const diffs = Object.entries(p1.diffs).map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count);

    send(res, 200, { phase: cfg.phase, counts, p1: { ...p1, diffs }, p2 });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}
