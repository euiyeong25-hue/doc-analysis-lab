import { K, getJSON, setJSON, hgetallJSON, hgetallMany, del, storeKind } from '../lib/store.js';
import {
  PHASES, DEFAULT_CONFIG, getConfig, send, readBody, clip, isAdmin, PRICE_IN, PRICE_OUT, MAX_CALLS,
} from '../lib/util.js';
import { MODEL, aiMode } from '../lib/ai.js';

// 발표자 전용: 자료 올리기, 단계 넘기기, 설정, 현황, 내보내기, 초기화
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!process.env.ADMIN_CODE) return send(res, 503, { error: 'Vercel 환경변수에 ADMIN_CODE를 먼저 넣어 주세요.' });
  const b = readBody(req);
  if (!isAdmin(req, b)) return send(res, 401, { error: '발표자 코드가 맞지 않아요.' });

  try {
    const cfg = await getConfig();
    switch (b.action) {
      case 'check':
        return send(res, 200, { ok: true, config: cfg, model: MODEL, aiMode, store: storeKind, maxCalls: MAX_CALLS });

      case 'config': {
        const p = b.patch || {};
        const next = { ...cfg };
        if ('excerpt' in p) next.excerpt = clip(p.excerpt, 4000);
        if ('sourceFull' in p) next.sourceFull = clip(p.sourceFull, 200);
        if ('sourceShort' in p) next.sourceShort = clip(p.sourceShort, 80) || DEFAULT_CONFIG.sourceShort;
        if ('defaultRQ' in p) next.defaultRQ = clip(p.defaultRQ, 300) || DEFAULT_CONFIG.defaultRQ;
        if ('aiEnabled' in p) next.aiEnabled = !!p.aiEnabled;
        if ('showNames' in p) next.showNames = !!p.showNames;
        if ('maxRuns' in p) next.maxRuns = Math.min(3, Math.max(1, Number(p.maxRuns) || 1));
        next.updatedAt = Date.now();
        await setJSON(K.config, next);
        return send(res, 200, { ok: true, config: next });
      }

      case 'phase': {
        if (!PHASES.includes(b.phase)) return send(res, 400, { error: 'bad phase' });
        const next = { ...cfg, phase: b.phase, updatedAt: Date.now() };
        await setJSON(K.config, next);
        return send(res, 200, { ok: true, config: next });
      }

      case 'stats': {
        const students = await hgetallJSON(K.students);
        const ids = Object.keys(students);
        const rows = await hgetallMany(ids.map(K.resp));
        const c = { participants: ids.length, p1: 0, p1ai: 0, p1diff: 0, p2: 0, p2ai: 0, p2cmp: 0 };
        rows.forEach((r) => {
          if (r.p1) c.p1++;
          if (r.p1ai?.length) c.p1ai++;
          if (r.p1diff) c.p1diff++;
          if (r.p2) c.p2++;
          if (r.p2ai?.length) c.p2ai++;
          if (r.p2cmp) c.p2cmp++;
        });
        const u = await hgetallJSON(K.usage);
        const input = Number(u.input || 0);
        const output = Number(u.output || 0);
        const cost = (input / 1e6) * PRICE_IN + (output / 1e6) * PRICE_OUT;
        return send(res, 200, {
          counts: c,
          usage: { calls: Number(u.calls || 0), input, output, costUSD: Math.round(cost * 1000) / 1000 },
          maxCalls: MAX_CALLS,
        });
      }

      case 'export': {
        const students = await hgetallJSON(K.students);
        const ids = Object.keys(students);
        const rows = await hgetallMany(ids.map(K.resp));
        const responses = {};
        ids.forEach((id, i) => { responses[id] = { name: students[id]?.name, ...rows[i] }; });
        return send(res, 200, {
          exportedAt: new Date().toISOString(), config: cfg, model: MODEL, usage: await hgetallJSON(K.usage), responses,
        });
      }

      case 'reset': {
        const students = await hgetallJSON(K.students);
        await del(K.students, K.usage, ...Object.keys(students).map(K.resp));
        const next = { ...cfg, phase: 'lobby', updatedAt: Date.now() };
        await setJSON(K.config, next);
        return send(res, 200, { ok: true, config: next });
      }

      default:
        return send(res, 400, { error: 'unknown action' });
    }
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}
