import { K, hgetallJSON, hsetJSON, hincr } from '../lib/store.js';
import { getConfig, send, readBody, clip, okId, MAX_CALLS } from '../lib/util.js';
import { analyze } from '../lib/ai.js';

// 같은 발췌문을 Claude에게 분석시키고, 결과를 모델·시각·프롬프트와 함께 기록한다.
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
    if (!cfg.excerpt) return send(res, 409, { error: '아직 자료가 올라오지 않았어요.' });

    const usage = await hgetallJSON(K.usage);
    if (Number(usage.calls || 0) >= MAX_CALLS) return send(res, 429, { error: '오늘 쓸 수 있는 AI 횟수를 다 썼어요.' });

    const mine = await hgetallJSON(K.resp(b.id));
    const field = `${stage}ai`;
    const runs = Array.isArray(mine[field]) ? mine[field] : [];
    if (runs.length >= cfg.maxRuns) return send(res, 429, { error: `AI는 이 단계에서 ${cfg.maxRuns}번까지 돌릴 수 있어요.` });

    const rq = stage === 'p2' ? clip(mine.p2?.rq || cfg.defaultRQ, 300) : null;
    const r = await analyze(stage, cfg, rq, runs.length + 1);
    const entry = { ...r.data, model: r.model, at: r.at, prompt: r.prompt, rq, run: runs.length + 1 };
    runs.push(entry);
    await hsetJSON(K.resp(b.id), field, runs);
    await hincr(K.usage, 'calls', 1);
    if (r.usage.input) await hincr(K.usage, 'input', r.usage.input);
    if (r.usage.output) await hincr(K.usage, 'output', r.usage.output);
    send(res, 200, { run: entry, runs });
  } catch (e) {
    const status = e?.status === 429 ? 429 : 502;
    const msg = e?.status === 429 ? 'AI가 잠깐 붐벼요. 10초 뒤에 다시 눌러 주세요.' : `AI 호출에 실패했어요: ${e.message}`;
    send(res, status, { error: msg });
  }
}
