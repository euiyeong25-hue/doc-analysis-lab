import { K, hsetJSON } from '../lib/store.js';
import { send, readBody, clip, okId } from '../lib/util.js';

// 학생이 쓴 답을 단계별로 저장한다. 같은 칸을 다시 내면 덮어쓴다.
const SECTIONS = {
  p1: { read: 1500, sentence: 300 },
  p1diff: { word: 40 },
  p2: { rq: 300, context: 1500, purpose: 1500, verify: 1500, sentence: 300 },
  p2cmp: { context: 300, purpose: 300, verify: 300, expression: 300 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const b = readBody(req);
  const spec = SECTIONS[b.section];
  if (!okId(b.id) || !spec) return send(res, 400, { error: 'bad request' });
  const data = {};
  for (const [k, n] of Object.entries(spec)) data[k] = clip(b.data?.[k], n);
  if (!Object.values(data).some(Boolean)) return send(res, 400, { error: '빈 답은 낼 수 없어요.' });
  data.at = Date.now();
  try {
    await hsetJSON(K.resp(b.id), b.section, data);
    send(res, 200, { ok: true, data });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}
