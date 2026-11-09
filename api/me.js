import { K, hgetallJSON } from '../lib/store.js';
import { send, okId } from '../lib/util.js';

// 새로고침해도 내가 쓴 답과 AI 답을 다시 불러온다
export default async function handler(req, res) {
  const id = req.query?.id;
  if (!okId(id)) return send(res, 400, { error: 'bad id' });
  try {
    send(res, 200, await hgetallJSON(K.resp(id)));
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}
