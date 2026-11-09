import { getConfig, send } from '../lib/util.js';
import { storeKind } from '../lib/store.js';
import { MODEL, aiMode } from '../lib/ai.js';

// 모든 화면이 2~3초마다 읽는 현재 상태(단계·자료·설정)
export default async function handler(req, res) {
  try {
    const cfg = await getConfig();
    send(res, 200, { ...cfg, model: MODEL, aiMode, store: storeKind });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}
