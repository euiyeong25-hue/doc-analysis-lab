import { K, getJSON } from './store.js';

export const PHASES = [
  'lobby', 'p1_human', 'p1_ai', 'p1_compare', 'explain', 'p2_human', 'p2_ai', 'p2_compare', 'summary',
];

export const DEFAULT_CONFIG = {
  phase: 'lobby',
  excerpt: '',
  sourceFull: '장현재, 「[교실창가에서] 아이들을 기다리며」, 한국교육신문 2020.5.20',
  sourceShort: '한국교육신문(2020.5.20)',
  defaultRQ: '온라인 개학기 교사는 자기 역할을 어떻게 다시 정의했는가?',
  aiEnabled: true,
  maxRuns: 2,
  showNames: false,
};

export async function getConfig() {
  const saved = await getJSON(K.config, {});
  return { ...DEFAULT_CONFIG, ...saved };
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

export const PRICE_IN = Number(process.env.PRICE_IN_PER_M || 2);   // USD / 1M input tokens (Sonnet 5.5)
export const PRICE_OUT = Number(process.env.PRICE_OUT_PER_M || 10); // USD / 1M output tokens
export const MAX_CALLS = Number(process.env.MAX_CALLS || 300);      // 수업 전체 AI 호출 상한
