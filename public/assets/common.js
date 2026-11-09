// 학생·보드·발표자 화면이 함께 쓰는 것들
export const PHASES = ['lobby', 'p1_human', 'p1_ai', 'p1_compare', 'explain', 'p2_source', 'p2_human', 'p2_ai', 'p2_compare', 'summary'];

export const PHASE_LABEL = {
  lobby: '대기',
  p1_human: '실습 1 · ① 혼자 읽기',
  p1_ai: '실습 1 · ② AI에게',
  p1_compare: '실습 1 · ③ 비교',
  explain: '설명',
  p2_source: '재실습 · ⓪ 출처·자료',
  p2_human: '재실습 · ① 다시 코딩',
  p2_ai: '재실습 · ② AI에게',
  p2_compare: '재실습 · ③ 비교',
  summary: '정리',
};

// 학생 화면 단계 띠에 쓰는 묶음 이름과 짧은 이름
export const STEP_META = {
  lobby: { group: '대기', name: '시작 전' },
  p1_human: { group: '실습 1', name: '① 혼자 읽기' },
  p1_ai: { group: '실습 1', name: '② AI에게' },
  p1_compare: { group: '실습 1', name: '③ 비교' },
  explain: { group: '설명', name: '틀 건네기' },
  p2_source: { group: '재실습', name: '⓪ 출처·자료' },
  p2_human: { group: '재실습', name: '① 다시 코딩' },
  p2_ai: { group: '재실습', name: '② AI에게' },
  p2_compare: { group: '재실습', name: '③ 비교' },
  summary: { group: '정리', name: '어디서 갈리나' },
};

// AI는 이 단계에서만 돌릴 수 있다 (api/analyze.js와 같게)
export const OPEN_AI = { p1: ['p1_ai', 'p1_compare'], p2: ['p2_ai', 'p2_compare'] };

// 단계별 시간(분). 여기만 고치면 학생 · 보드 · 발표자 화면의 시계와 안내가 함께 바뀐다.
// 도입 2분 30초 · 실습 1 11분(5·3·3) · 설명 7분 · 재실습 18분(5·5·3·5) · 정리 4분
export const PHASE_MIN = {
  p1_human: 5, p1_ai: 3, p1_compare: 3, explain: 7,
  p2_source: 5, p2_human: 5, p2_ai: 3, p2_compare: 5, summary: 4,
};
export const INTRO_MIN = 2.5;
const sumMin = (ids) => ids.reduce((a, k) => a + PHASE_MIN[k], 0);
export const P1_MIN = sumMin(['p1_human', 'p1_ai', 'p1_compare']);
export const P2_MIN = sumMin(['p2_source', 'p2_human', 'p2_ai', 'p2_compare']);
export const FLOW = [
  ['도입', INTRO_MIN, 'f-in'], ['실습 1', P1_MIN, 'f-p1'], ['설명', PHASE_MIN.explain, 'f-ex'],
  ['재실습', P2_MIN, 'f-p2'], ['정리', PHASE_MIN.summary, 'f-sum'],
];
export const FLOW_TOTAL = FLOW.reduce((a, f) => a + f[1], 0);

export const CHECK = [['me', '나만'], ['ai', 'AI만'], ['both', '둘 다'], ['none', '둘 다 못함']];
export const CHECK_BOARD = [['me', '사람만'], ['ai', 'AI만'], ['both', '둘 다'], ['none', '둘 다 못함']];
export const CRIT = ['진정성', '신빙성', '대표성', '의미'];

async function call(path, opts) {
  let r;
  try {
    r = await fetch(path, { cache: 'no-store', ...opts });
  } catch {
    throw Object.assign(new Error('인터넷 연결이 끊긴 것 같아요. 잠시 뒤 다시 해 주세요.'), { status: 0 });
  }
  let j = {};
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) {
    const msg = j.error || (r.status === 504 ? '서버 응답이 너무 늦어요. 한 번 더 해 주세요.' : `요청 실패 (${r.status})`);
    throw Object.assign(new Error(msg), { status: r.status });
  }
  return j;
}

export const api = {
  get: (path) => call(path),
  post: (path, body, headers = {}) => call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }),
};

// 안전한 DOM 생성: 문자열은 항상 textContent로 들어간다
export function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'value') n.value = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}
export const el = h;

// node.replaceChildren(null)은 "null" 글자를 넣는다. 빈 값은 걸러서 넣는다.
export function fill(node, ...kids) {
  node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false && k !== ''));
  return node;
}

export const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : '');
export const fmtMin = (m) => { const w = Math.floor(m); const s = Math.round((m - w) * 60); return s ? (w ? `${w}분 ${s}초` : `${s}초`) : `${w}분`; };
export const secs = (ms) => Math.max(1, Math.round((ms || 0) / 1000));

// 단계별 남은 시간. offset = 서버 시각 - 내 시각
export function remaining(cfg, offset) {
  const min = PHASE_MIN[cfg?.phase];
  if (!min || !cfg.phaseAt) return null;
  return Math.round(min * 60 - ((Date.now() + offset) - cfg.phaseAt) / 1000);
}
export const clockText = (left) => (left == null ? '' : left <= 0 ? '시간 끝' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);

export const store = {
  get(k, d) {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ }
  },
};

let toastTimer;
export function toast(msg, bad = false) {
  let t = document.querySelector('.toast');
  if (!t) { t = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 4200 : 2200);
}

export function flowBar() {
  return h('div', { class: 'flow', role: 'img', 'aria-label': FLOW.map(([l, m]) => `${l} ${fmtMin(m)}`).join(', ') },
    FLOW.map(([l, m, c]) => h('div', { class: c, title: `${l} ${fmtMin(m)}`, style: { flexGrow: String(m), flexBasis: '0' } }, h('span', { text: l }))));
}

export function makeQR(node, text, size) {
  node.replaceChildren();
  if (window.QRCode) {
    // eslint-disable-next-line no-new
    new window.QRCode(node, { text, width: size, height: size, colorDark: '#1F2430', colorLight: '#ffffff' });
  } else {
    node.append(h('div', { class: 'muted', text }));
  }
}
