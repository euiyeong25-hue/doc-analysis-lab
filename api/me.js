import { K, hgetJSON, hgetallJSON } from '../lib/store.js';
import { send, okId } from '../lib/util.js';

// 새로고침해도 내가 쓴 답과 AI 답을 다시 불러온다.
// me가 null이면 발표자가 '모두 지우기'를 한 뒤라서, 학생 화면이 같은 이름으로 다시 들어온다.
export default async function handler(req, res) {
  const id = req.query?.id;
  if (!okId(id)) return send(res, 400, { error: 'bad id' });
  try {
    const [me, resp] = await Promise.all([hgetJSON(K.students, id), hgetallJSON(K.resp(id))]);
    send(res, 200, { me: me || null, resp });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}
