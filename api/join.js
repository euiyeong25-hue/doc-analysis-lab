import { K, hgetJSON, hsetJSON } from '../lib/store.js';
import { send, readBody, clip, okId } from '../lib/util.js';

// 이름(별명)으로 들어온다. 이름만 바꿔도 처음 들어온 시각은 그대로 둔다.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const b = readBody(req);
  const name = clip(b.name, 20);
  if (!okId(b.id) || !name) return send(res, 400, { error: '이름을 입력해 주세요.' });
  try {
    const prev = await hgetJSON(K.students, b.id);
    await hsetJSON(K.students, b.id, { name, joinedAt: prev?.joinedAt || Date.now() });
    send(res, 200, { ok: true });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}
