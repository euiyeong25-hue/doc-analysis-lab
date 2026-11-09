// 본문을 번호 붙은 단위(문단·줄)와 문장으로 나누고, AI에게 보낼 질문을 만든다.
// 브라우저(학생·보드·발표자 화면)와 서버(api/*.js)가 같은 파일을 쓴다.

export const GAP_RE = /^[(\[〔]?\s*(…+|\.{3,}|중략|생략)\s*[)\]〕]?$/;
export const SENT_RE = /(?<=\D[.?!][”"’')\]]*)\s+(?=\S)/;
export const isHeading = (t) => t.length <= 30 && !/[.?!…。”"’')\]]$/.test(t);
export const splitSentences = (t) => t.split(SENT_RE).map((s) => s.trim()).filter(Boolean);
export const circ = (n) => (n >= 1 && n <= 20 ? String.fromCodePoint(0x245F + n) : `(${n})`);

// 줄바꿈 하나 = 번호 하나. (…)만 있는 줄은 건너뛴 표시, 짧고 마침표 없는 줄은 소제목.
export function parseLines(raw) {
  const out = [];
  let n = 0;
  for (const r of String(raw || '').split(/\r?\n/)) {
    let t = r.trim();
    if (!t) continue;
    if (GAP_RE.test(t)) { if (!out.length || !out[out.length - 1].gap) out.push({ gap: true }); continue; }
    t = t.replace(/^(?:[①-⑳]\s*|\(?\d{1,2}[.)]\s+)/, '').trim();
    if (!t) continue;
    if (isHeading(t)) { out.push({ head: true, text: t }); continue; }
    n += 1;
    out.push({ n, text: t, sents: splitSentences(t) });
  }
  return out;
}

export const segParts = (seg) => String(seg).split('-').map(Number);
export const segLabel = (seg) => { const [p, s] = segParts(seg); return `${circ(p)}-${s}`; };
export const segSort = (a, b) => { const [ap, as] = segParts(a); const [bp, bs] = segParts(b); return ap - bp || as - bs; };

export function makeDoc(raw) {
  const lines = parseLines(raw);
  const nums = lines.filter((l) => l.n);
  const byN = new Map(nums.map((l) => [l.n, l]));
  const avg = nums.length ? nums.reduce((a, l) => a + l.text.length, 0) / nums.length : 0;
  const segText = (seg) => {
    const [p, s] = segParts(seg);
    const l = byN.get(p);
    return l && l.sents[s - 1] ? l.sents[s - 1] : '';
  };
  return {
    raw: String(raw || ''),
    lines,
    unit: avg > 80 ? '문단' : '줄',
    count: nums.length,
    heads: lines.filter((l) => l.head).length,
    sents: nums.reduce((a, l) => a + l.sents.length, 0),
    textOf: (n) => (byN.get(n) || {}).text || '',
    segText,
    validSeg: (seg) => typeof seg === 'string' && /^\d{1,2}-\d{1,2}$/.test(seg) && !!segText(seg),
    numbered: () => lines.map((l) => (l.gap ? '(…)' : l.head ? `[소제목] ${l.text}` : `${circ(l.n)} ${l.text}`)).join('\n'),
    sentenced: () => lines.map((l) => (l.gap ? '(…)' : l.head ? `[소제목] ${l.text}`
      : `${circ(l.n)} ${l.sents.map((s, j) => `[${l.n}-${j + 1}] ${s}`).join(' ')}`)).join('\n'),
  };
}

export function toNum(x) {
  if (typeof x === 'number' && Number.isFinite(x)) return Math.round(x);
  const s = String(x ?? '').trim();
  const cp = s.codePointAt(0);
  if (cp >= 0x2460 && cp <= 0x2473) return cp - 0x245F;
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : NaN;
}

export function parseSeg(x, doc) {
  const s = String(x ?? '').replace(/[①-⑳]/g, (c) => String(c.codePointAt(0) - 0x245F));
  const m = s.match(/(\d+)\s*[-–—.·_:]\s*(\d+)/);
  if (!m) return null;
  const seg = `${+m[1]}-${+m[2]}`;
  return doc.validSeg(seg) ? seg : null;
}

export const scopeWord = (cfg) => (cfg && cfg.scope === 'part' ? '일부' : '전문');

// AI에게 보내는 질문. 긴 본문을 앞에, 과제를 뒤에 둔다.
// 앞부분(HEAD)은 모든 학생에게 똑같아서 API 쪽에서 캐시해 다시 쓴다.
export const P1_HEAD = [
  '다음은 {출처}에 실린 한 교사의 칼럼 {범위}이다. {단위}마다 번호가 붙어 있다.',
  '',
  '[본문]',
  '{발췌문}',
].join('\n');
export const P1_TASK = '질적연구자로서 이 문서를 분석해 줘. 가장 중요한 {단위}을 1~2개 골라 번호로 밝히고, 왜 그 {단위}인지 짧게 써 줘. 그리고 이 문서가 무엇을 보여 주는지 한 문장으로 써 줘.';

export const P2_HEAD = [
  '다음은 {출처}에 실린 한 교사의 칼럼 {범위}이다. {단위}마다 번호가 붙어 있고, 문장마다 [{단위}-문장] 번호가 붙어 있다.',
  '',
  '[본문]',
  '{문장본문}',
].join('\n');
export const P2_TASK = [
  '내 연구 질문은 ‘{연구질문}’이다. 아래 네 가지에 차례로 답해 줘.',
  '① 누가·누구에게·왜·언제 쓴 문서인가? (실린 매체와 독자까지)',
  '② 다시 코딩: 내 연구 질문에 비추어 의미 있는 문장을 3~5개 골라 [{단위}-문장] 번호를 밝히고, 그 문장이 무엇의 증거인지 짧은 코드를 붙여 줘.',
  '③ 믿기 전에 무엇을 확인해야 하나? (Scott의 네 준거인 진정성·신빙성·대표성·의미 가운데 하나를 골라서)',
  '④ 이 문서가 보여 주는 것을 한 문장으로 다시 써 줘.',
].join('\n');

const str = (v) => String(v ?? '').trim();

// {출처} {연구질문} {단위} {범위} 를 채우고, 본문 자리({발췌문} {문장본문})는 맨 나중에 채운다.
export function fillPrompt(t, v) {
  return t.split('{출처}').join(v.source)
    .split('{연구질문}').join(v.rq)
    .split('{단위}').join(v.unit)
    .split('{범위}').join(v.scope)
    .split('{문장본문}').join(v.sentenced)
    .split('{발췌문}').join(v.numbered);
}

export function srcLines(src) {
  if (!src || typeof src !== 'object') return [];
  const L = [];
  if (str(src.author)) L.push(`필자: ${str(src.author)}`);
  if (str(src.outlet)) L.push(`매체·독자: ${str(src.outlet)}`);
  if (str(src.day)) L.push(`그날: ${str(src.day)}`);
  if (str(src.why)) L.push(`왜: ${str(src.why)}`);
  (Array.isArray(src.extras) ? src.extras : [])
    .filter((x) => x && (str(x.name) || str(x.note)))
    .forEach((x) => L.push(`추가 자료: ${str(x.name) || '(이름 없음)'}${str(x.note) ? ` — ${str(x.note)}` : ''}`));
  return L;
}

// kind: 'p1' | 'p2'. head = 칼럼 소개 + 번호 붙은 본문(모두 같음), tail = 과제(연구 질문이 들어감).
// src를 주면 과제 앞에 '내가 찾은 출처와 추가 자료'를 넣는다.
export function promptParts(kind, cfg, doc, rq, src) {
  const v = {
    source: str(cfg.sourceShort) || '한 신문',
    rq: str(rq) || str(cfg.defaultRQ),
    unit: doc.unit,
    scope: scopeWord(cfg),
    numbered: kind === 'p1' ? doc.numbered() : '',
    sentenced: kind === 'p2' ? doc.sentenced() : '',
  };
  const head = fillPrompt(kind === 'p1' ? P1_HEAD : P2_HEAD, v);
  let tail = fillPrompt(kind === 'p1' ? P1_TASK : P2_TASK, v);
  const L = src ? srcLines(src) : [];
  if (L.length) tail = `[내가 찾은 출처와 추가 자료]\n${L.join('\n')}\n\n${tail}`;
  return { head, tail };
}

export function buildPrompt(kind, cfg, doc, rq, src) {
  const p = promptParts(kind, cfg, doc, rq, src);
  return `${p.head}\n\n${p.tail}`;
}
