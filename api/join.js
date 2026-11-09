import { K, hsetJSON } from '../lib/store.js';
import { send, readBody, clip, okId } from '../lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const b = readBody(req);
  const name = clip(b.name, 20);
  if (!okId(b.id) || !name) return send(res, 400, { error: '이름을 입력해 주세요.' });
  try {
    await hsetJSON(K.students, b.id, { name, joinedAt: Date.now() });
    send(res, 200, { ok: true });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}
