import { getConfig, send } from '../lib/util.js';
import { collect, summarize } from '../lib/agg.js';

// 프로젝터 보드(와 학생 '정리' 화면): 지금 단계, 본문, 반 전체 결과(기본은 이름 없이)
export default async function handler(req, res) {
  try {
    const cfg = await getConfig();
    const { students, ids, rows } = await collect();
    send(res, 200, {
      cfg: {
        phase: cfg.phase, phaseAt: cfg.phaseAt, raw: cfg.raw, sourceFull: cfg.sourceFull, sourceShort: cfg.sourceShort,
        defaultRQ: cfg.defaultRQ, scope: cfg.scope, showNames: cfg.showNames,
      },
      now: Date.now(),
      ...summarize(students, ids, rows, cfg.showNames),
    });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}
