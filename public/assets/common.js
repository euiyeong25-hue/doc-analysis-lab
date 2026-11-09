export const PHASE_LABEL = {
  lobby: '대기',
  p1_human: '실습 1 · ① 사람',
  p1_ai: '실습 1 · ② AI',
  p1_compare: '실습 1 · ③ 비교',
  explain: '설명',
  p2_human: '재실습 · ① 사람',
  p2_ai: '재실습 · ② AI',
  p2_compare: '재실습 · ③ 비교',
  summary: '정리',
};

async function call(path, opts) {
  const r = await fetch(path, { cache: 'no-store', ...opts });
  let j = {};
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw new Error(j.error || `요청 실패 (${r.status})`);
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
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'value') n.value = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '');

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
  if (!t) { t = el('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 4200 : 1800);
}

// 서버(lib/ai.js)와 같은 프롬프트 — 실행 전 미리보기용
export function previewPrompt(stage, cfg, rq) {
  const head = `다음은 ${cfg.sourceShort}에 실린 한 교사의 칼럼 일부다.`;
  if (stage === 'p1') {
    return `${head} 질적연구자로서 이 문서를 분석하고, 이 문서가 무엇을 보여 주는지 한 문장으로 써 줘.\n\n[발췌문]\n${cfg.excerpt}`;
  }
  return `${head} 내 연구 질문은 ‘${rq}’이다.\n`
    + '① 누가·누구에게·왜·언제 썼나 ② 무엇의 증거가 될 수 있나 ③ Scott의 네 준거(진정성·신빙성·대표성·의미)로 무엇을 확인해야 하나 '
    + `④ 이 문서가 보여 주는 것을 한 문장으로 써 줘.\n\n[발췌문]\n${cfg.excerpt}`;
}

export function makeQR(node, text, size) {
  node.replaceChildren();
  if (window.QRCode) {
    // eslint-disable-next-line no-new
    new window.QRCode(node, { text, width: size, height: size, colorDark: '#1F2430', colorLight: '#ffffff' });
  } else {
    node.append(el('div', { class: 'muted', text }));
  }
}
