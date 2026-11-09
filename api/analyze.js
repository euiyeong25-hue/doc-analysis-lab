import { K, hgetallJSON, hsetJSON, hincr } from '../lib/store.js';
import { getConfig, send, readBody, clip, okId, MAX_CALLS } from '../lib/util.js';
import { analyze } from '../lib/ai.js';
import { makeDoc, srcLines } from '../public/assets/text.js';

// 같은 본문을 Claude에게 분석시키고, 결과를 모델·시각·프롬프트와 함께 기록한다.
const OPEN_PHASES = { p1: ['p1_ai', 'p1_compare'], p2: ['p2_ai', 'p2_compare'] };

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const b = readBody(req);
  const stage = b.stage;
  if (!okId(b.id) || !OPEN_PHASES[stage]) return send(res, 400, { error: 'bad request' });
  try {
    const cfg = await getConfig();
    if (!cfg.aiEnabled) return send(res, 403, { error: '지금은 AI가 꺼져 있어요.' });
    if (!OPEN_PHASES[stage].includes(cfg.phase)) return send(res, 409, { error: '지금은 이 단계가 아니에요.' });
    const doc = makeDoc(cfg.raw);
    if (doc.count < 2) return send(res, 409, { error: '아직 본문이 올라오지 않았어요.' });

    const usage = await hgetallJSON(K.usage);
    if (Number(usage.calls || 0) >= MAX_CALLS) return send(res, 429, { error: '오늘 쓸 수 있는 AI 횟수를 다 썼어요.' });

    const mine = await hgetallJSON(K.resp(b.id));
    const field = `${stage}ai`;
    const runs = Array.isArray(mine[field]) ? mine[field] : [];
    if (runs.length >= cfg.maxRuns) return send(res, 429, { error: `AI는 이 단계에서 ${cfg.maxRuns}번까지 돌릴 수 있어요.` });

    const rq = stage === 'p2' ? clip(mine.p2?.rq || cfg.defaultRQ, 300) : null;
    const src = stage === 'p2' && b.withSrc ? mine.src : null;
    if (b.withSrc && !srcLines(src).length) return send(res, 400, { error: '먼저 출처·자료 칸을 채워 주세요.' });

    const r = await analyze(stage, cfg, doc, rq, src, runs.length + 1);
    const entry = { data: r.data, model: r.model, at: r.at, ms: r.ms, prompt: r.prompt, rq, run: runs.length + 1, withSrc: !!src };
    runs.push(entry);
    await hsetJSON(K.resp(b.id), field, runs);
    await hincr(K.usage, 'calls', 1);
    for (const k of ['input', 'cacheWrite', 'cacheRead', 'output']) {
      if (r.usage[k]) await hincr(K.usage, k, r.usage[k]);
    }
    send(res, 200, { run: entry, runs });
  } catch (e) {
    console.error('[analyze]', e?.status, e?.message);
    const m = String(e?.message || '');
    let status = 502;
    let msg = `AI 호출에 실패했어요: ${m.slice(0, 300)}`;
    if (e?.status === 429 || e?.status === 529) { status = 429; msg = 'AI가 잠깐 붐벼요. 10초 뒤에 다시 눌러 주세요.'; }
    else if (e?.status === 401 || e?.status === 403) msg = 'AI 키가 맞지 않거나 만료됐어요. 발표자에게 알려 주세요.';
    else if (/credit balance/i.test(m)) msg = 'API 충전금이 모자라요. 발표자에게 알려 주세요.';
    send(res, status, { error: msg });
  }
}
