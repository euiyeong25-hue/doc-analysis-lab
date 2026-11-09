import { K, getJSON } from './store.js';

export const PHASES = [
  'lobby', 'p1_human', 'p1_ai', 'p1_compare', 'explain', 'p2_source', 'p2_human', 'p2_ai', 'p2_compare', 'summary',
];

export const DEFAULT_CONFIG = {
  phase: 'lobby',
  phaseAt: 0,
  raw: '',
  sourceFull: '장현재, 「[교실창가에서] 아이들을 기다리며」, 한국교육신문 2020.5.20',
  sourceShort: '한국교육신문(2020.5.20)',
  defaultRQ: '온라인 개학기 교사는 자기 역할을 어떻게 다시 정의했는가?',
  scope: 'full',
  aiEnabled: true,
  maxRuns: 2,
  showNames: false,
  epoch: 0, // '모두 지우기'를 할 때마다 바뀐다. 학생 화면은 이걸 보고 새로 시작한 걸 안다.
};

export async function getConfig() {
  const saved = await getJSON(K.config, {});
  const cfg = { ...DEFAULT_CONFIG, ...saved };
  if (!cfg.raw && saved.excerpt) cfg.raw = saved.excerpt; // 첫 버전(excerpt)과 호환
  delete cfg.excerpt;
  return cfg;
}

export function send(res, status, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(obj);
}

export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

export const clip = (s, n) => String(s ?? '').trim().slice(0, n);
export const okId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);

export function isAdmin(req, body) {
  const code = process.env.ADMIN_CODE;
  if (!code) return false;
  return body.code === code || req.headers['x-admin-code'] === code;
}

export const CHECKS = ['me', 'ai', 'both', 'none'];
export const CRITS = ['진정성', '신빙성', '대표성', '의미'];

export const PRICE_IN = Number(process.env.PRICE_IN_PER_M || 2);   // USD / 1M input tokens (Sonnet 5.5)
export const PRICE_OUT = Number(process.env.PRICE_OUT_PER_M || 10); // USD / 1M output tokens
export const MAX_CALLS = Number(process.env.MAX_CALLS || 300);      // 수업 전체 AI 호출 상한

// 캐시에 쓰는 입력은 1.25배, 캐시에서 읽는 입력은 0.1배 값으로 센다.
export function costUSD(u) {
  const n = (k) => Number(u?.[k] || 0);
  const usd = (n('input') + n('cacheWrite') * 1.25 + n('cacheRead') * 0.1) / 1e6 * PRICE_IN + n('output') / 1e6 * PRICE_OUT;
  return Math.round(usd * 1000) / 1000;
}
