import { K, setJSON, hgetallJSON, del, storeKind } from '../lib/store.js';
import {
  PHASES, DEFAULT_CONFIG, getConfig, send, readBody, clip, isAdmin, MAX_CALLS, costUSD,
} from '../lib/util.js';
import { MODEL, aiMode } from '../lib/ai.js';
import { collect, summarize, people } from '../lib/agg.js';

const num = (v) => Number(v || 0);

// 발표자 전용: 본문 올리기, 단계 넘기기, 설정, 현황·참여자, 내보내기, 초기화
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!process.env.ADMIN_CODE) return send(res, 503, { error: 'Vercel 환경변수에 ADMIN_CODE를 먼저 넣어 주세요.' });
  const b = readBody(req);
  if (!isAdmin(req, b)) return send(res, 401, { error: '발표자 코드가 맞지 않아요.' });

  try {
    const cfg = await getConfig();
    const env = { model: MODEL, aiMode, store: storeKind, maxCalls: MAX_CALLS };
    switch (b.action) {
      case 'check':
        return send(res, 200, { ok: true, config: cfg, ...env, now: Date.now() });

      case 'config': {
        const p = b.patch || {};
        const next = { ...cfg };
        if ('raw' in p) next.raw = String(p.raw ?? '').slice(0, 12000);
        if ('sourceFull' in p) next.sourceFull = clip(p.sourceFull, 200);
        if ('sourceShort' in p) next.sourceShort = clip(p.sourceShort, 80) || DEFAULT_CONFIG.sourceShort;
        if ('defaultRQ' in p) next.defaultRQ = clip(p.defaultRQ, 300) || DEFAULT_CONFIG.defaultRQ;
        if ('scope' in p) next.scope = p.scope === 'part' ? 'part' : 'full';
        if ('aiEnabled' in p) next.aiEnabled = !!p.aiEnabled;
        if ('showNames' in p) next.showNames = !!p.showNames;
        if ('maxRuns' in p) next.maxRuns = Math.min(3, Math.max(1, Number(p.maxRuns) || 1));
        next.updatedAt = Date.now();
        await setJSON(K.config, next);
        return send(res, 200, { ok: true, config: next, now: Date.now() });
      }

      case 'phase': {
        if (!PHASES.includes(b.phase)) return send(res, 400, { error: 'bad phase' });
        const next = { ...cfg, phase: b.phase, phaseAt: Date.now(), updatedAt: Date.now() };
        await setJSON(K.config, next);
        return send(res, 200, { ok: true, config: next, now: Date.now() });
      }

      case 'stats': {
        const { students, ids, rows } = await collect();
        const sum = summarize(students, ids, rows, true);
        const u = await hgetallJSON(K.usage);
        return send(res, 200, {
          now: Date.now(),
          config: cfg,
          ...env,
          counts: sum.counts,
          usage: {
            calls: num(u.calls), input: num(u.input), cacheWrite: num(u.cacheWrite), cacheRead: num(u.cacheRead),
            output: num(u.output), costUSD: costUSD(u),
          },
          people: people(students, ids, rows),
        });
      }

      case 'export': {
        const { students, ids, rows } = await collect();
        const responses = {};
        ids.forEach((id, i) => { responses[id] = { name: students[id]?.name, joinedAt: students[id]?.joinedAt, ...rows[i] }; });
        const u = await hgetallJSON(K.usage);
        return send(res, 200, {
          exportedAt: new Date().toISOString(), config: cfg, model: MODEL, usage: { ...u, costUSD: costUSD(u) }, responses,
        });
      }

      case 'reset': {
        const students = await hgetallJSON(K.students);
        await del(K.students, K.usage, ...Object.keys(students).map(K.resp));
        const now = Date.now();
        const next = { ...cfg, phase: 'lobby', phaseAt: now, epoch: now, updatedAt: now };
        await setJSON(K.config, next);
        return send(res, 200, { ok: true, config: next, now });
      }

      default:
        return send(res, 400, { error: 'unknown action' });
    }
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}
