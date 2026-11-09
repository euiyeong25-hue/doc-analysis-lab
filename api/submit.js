import { K, hsetJSON } from '../lib/store.js';
import { send, readBody, clip, okId, CHECKS, CRITS } from '../lib/util.js';

// 학생 답을 칸(section)별로 저장한다. 학생 화면이 고칠 때마다 자동으로 보낸다(덮어쓰기).
const chk = (v) => (CHECKS.includes(v) ? v : '');
const list = (v) => (Array.isArray(v) ? v : []);
const SECTIONS = {
  p1: (d) => ({
    lines: [...new Set(list(d.lines).map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= 60))].slice(0, 2),
    why: clip(d.why, 300),
    sentence: clip(d.sentence, 400),
  }),
  p1cmp: (d) => ({ who: chk(d.who), word: clip(d.word, 40) }),
  src: (d) => ({
    author: clip(d.author, 200), outlet: clip(d.outlet, 200), day: clip(d.day, 200), why: clip(d.why, 300),
    extras: list(d.extras).slice(0, 3).map((x) => ({ name: clip(x?.name, 300), note: clip(x?.note, 300) })),
  }),
  p2: (d) => ({
    rq: clip(d.rq, 300),
    codes: list(d.codes).filter((c) => c && /^\d{1,2}-\d{1,2}$/.test(String(c.seg))).slice(0, 8)
      .map((c) => ({ seg: String(c.seg), code: clip(c.code, 60) })),
    crit: CRITS.includes(d.crit) ? d.crit : '',
    verify: clip(d.verify, 600),
    sentence: clip(d.sentence, 400),
  }),
  p2cmp: (d) => ({ context: chk(d.context), coding: chk(d.coding), verify: chk(d.verify), voice: chk(d.voice), remain: clip(d.remain, 300) }),
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const b = readBody(req);
  const clean = SECTIONS[b.section];
  if (!okId(b.id) || !clean || !b.data || typeof b.data !== 'object') return send(res, 400, { error: 'bad request' });
  const data = { ...clean(b.data), at: Date.now() };
  try {
    await hsetJSON(K.resp(b.id), b.section, data);
    send(res, 200, { ok: true, at: data.at });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}
