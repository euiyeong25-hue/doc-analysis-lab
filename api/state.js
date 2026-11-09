import { getConfig, send } from '../lib/util.js';
import { storeKind } from '../lib/store.js';
import { MODEL, aiMode } from '../lib/ai.js';

// 모든 화면이 몇 초마다 읽는 현재 상태(단계·본문·설정). now는 남은 시간 계산용 서버 시각.
export default async function handler(req, res) {
  try {
    const cfg = await getConfig();
    send(res, 200, { ...cfg, model: MODEL, aiMode, store: storeKind, now: Date.now() });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}
