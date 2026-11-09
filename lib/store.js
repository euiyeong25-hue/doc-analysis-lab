// 저장소: Vercel에 Upstash Redis를 연결하면 Redis를, 아니면(로컬 테스트) 메모리를 쓴다.
import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;

export const storeKind = redis ? 'redis' : 'memory';

const mem = globalThis.__labMem || (globalThis.__labMem = { kv: new Map(), h: new Map() });

export const K = {
  config: 'lab:config',
  students: 'lab:students',
  usage: 'lab:usage',
  resp: (id) => `lab:resp:${id}`,
};

export async function getJSON(key, fallback = null) {
  const raw = redis ? await redis.get(key) : mem.kv.get(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export async function setJSON(key, value) {
  const raw = JSON.stringify(value);
  if (redis) await redis.set(key, raw);
  else mem.kv.set(key, raw);
}

export async function hsetJSON(key, field, value) {
  const raw = JSON.stringify(value);
  if (redis) await redis.hset(key, { [field]: raw });
  else {
    if (!mem.h.has(key)) mem.h.set(key, new Map());
    mem.h.get(key).set(field, raw);
  }
}

function parseHash(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    try { out[k] = JSON.parse(v); } catch { out[k] = v; }
  }
  return out;
}

export async function hgetJSON(key, field) {
  const raw = redis ? await redis.hget(key, field) : mem.h.get(key)?.get(field);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function hgetallJSON(key) {
  if (redis) return parseHash(await redis.hgetall(key));
  const m = mem.h.get(key);
  return parseHash(m ? Object.fromEntries(m) : {});
}

export async function hgetallMany(keys) {
  if (!keys.length) return [];
  if (redis) {
    const p = redis.pipeline();
    keys.forEach((k) => p.hgetall(k));
    const rows = await p.exec();
    return rows.map(parseHash);
  }
  return keys.map((k) => parseHash(mem.h.get(k) ? Object.fromEntries(mem.h.get(k)) : {}));
}

export async function hincr(key, field, n) {
  if (redis) return redis.hincrby(key, field, n);
  if (!mem.h.has(key)) mem.h.set(key, new Map());
  const m = mem.h.get(key);
  const v = Number(m.get(field) || 0) + n;
  m.set(field, String(v));
  return v;
}

export async function del(...keys) {
  if (!keys.length) return;
  if (redis) await redis.del(...keys);
  else keys.forEach((k) => { mem.kv.delete(k); mem.h.delete(k); });
}
