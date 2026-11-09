// 학생 화면: 발표자가 넘기는 단계를 따라가며, 같은 칼럼을 나와 AI가 읽고 비교한다.
// 적은 답은 칸마다 자동 저장(/api/submit)되고, AI는 서버(/api/analyze)가 돌린다.
import {
  PHASES, PHASE_LABEL, PHASE_MIN, STEP_META, OPEN_AI, CHECK, CHECK_BOARD, CRIT,
  api, h, fill, fmtTime, fmtMin, secs, remaining, clockText, store, toast, flowBar,
} from './common.js';
import {
  makeDoc, circ, segParts, segLabel, segSort, scopeWord, buildPrompt, srcLines,
} from './text.js';
import {
  lineChart, checkChart, codeTallies, topSegs, itemList, keys, DIM_P1, DIM_P2,
} from './charts.js';

// ---------------- 작은 도구 ----------------
const $ = (s) => document.querySelector(s);
const clone = (o) => JSON.parse(JSON.stringify(o));
const str = (v) => String(v ?? '').trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const uniq = (a) => [...new Set(a)].sort((x, y) => x - y);
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const narrow = () => !!(window.matchMedia && window.matchMedia('(max-width: 899px)').matches);
const idx = (p) => PHASES.indexOf(p);
const checkLabel = (v) => (CHECK.find((c) => c[0] === v) || [null, '—'])[1];
const STEP_IDS = PHASES.filter((p) => p !== 'lobby');
const SENT_VIEWS = ['p2_human', 'p2_ai', 'p2_compare', 'summary'];
const HUMAN_VIEWS = ['p1_human', 'p2_human'];
const MAX_CODES = 8;
const MAX_EXTRAS = 3;

const DEFAULTS = {
  p1: { lines: [], why: '', sentence: '' },
  p1ai: [],
  p1cmp: { who: '', word: '' },
  src: { author: '', outlet: '', day: '', why: '', extras: [] },
  p2: { rq: '', codes: [], crit: '', verify: '', sentence: '' },
  p2ai: [],
  p2cmp: { context: '', coding: '', verify: '', voice: '', remain: '' },
};

// ---------------- 상태 ----------------
let cfg = null; // /api/state
let doc = makeDoc('');
let offset = 0; // 서버 시각 - 내 시각
let S = clone(DEFAULTS);
let lastEpoch = null;
let pending = null;
const me = { id: null, name: '', joined: false };
const ui = {
  boot: 'loading', bootErr: '', net: true, view: 'lobby', follow: true, docOpen: true, err: null,
  sel: { p1: -1, p2: -1 }, seen: {}, savedAt: 0, saveErr: false, joining: false, joinErr: '', editName: false,
  board: null, boardAt: 0, boardLoading: false, openPrompt: { p1: false, p2: false }, reportOpen: false,
  centered: null, lastInput: 0,
};

function fromServer(resp) {
  const s = clone(DEFAULTS);
  for (const k of Object.keys(s)) {
    const v = resp?.[k];
    if (Array.isArray(s[k])) s[k] = Array.isArray(v) ? v : [];
    else if (v && typeof v === 'object') {
      for (const f of Object.keys(s[k])) if (f in v && typeof v[f] === typeof s[k][f]) s[k][f] = v[f];
    }
  }
  s.p1.lines = uniq(arr(s.p1.lines).map(Number).filter(Number.isInteger));
  s.p2.codes = arr(s.p2.codes).filter((c) => c && typeof c.seg === 'string')
    .map((c) => ({ seg: c.seg, code: typeof c.code === 'string' ? c.code : '' }));
  s.src.extras = arr(s.src.extras).filter((x) => x && typeof x === 'object').slice(0, MAX_EXTRAS)
    .map((x) => ({ name: typeof x.name === 'string' ? x.name : '', note: typeof x.note === 'string' ? x.note : '' }));
  s.p1ai = s.p1ai.filter((r) => r && r.data);
  s.p2ai = s.p2ai.filter((r) => r && r.data);
  return s;
}

function getId() {
  let id = store.get('dal-id', null);
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    id = window.crypto && crypto.randomUUID ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    store.set('dal-id', id);
  }
  return id;
}

// ---------------- 본문 · 출처 ----------------
const U = () => doc.unit;
const authorName = () => (str(cfg?.sourceFull).split(/[,，]/)[0] || '').trim();
const outletName = () => (str(cfg?.sourceShort).replace(/\(.*?\)/g, '').trim() || '신문');
function docDate() {
  const m = `${cfg?.sourceFull || ''} ${cfg?.sourceShort || ''}`.match(/(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})/);
  return m ? { label: `${m[1]}.${+m[2]}.${+m[3]}`, words: `${m[1]}년 ${+m[2]}월 ${+m[3]}일` } : null;
}
const rq = () => str(S.p2.rq) || str(cfg?.defaultRQ);
const srcFilled = () => srcLines(S.src).length > 0;
function sel(kind) {
  const list = S[`${kind}ai`];
  if (!list.length) return -1;
  const i = ui.sel[kind];
  return i < 0 || i >= list.length ? list.length - 1 : i;
}
const curRun = (kind) => { const i = sel(kind); return i >= 0 ? S[`${kind}ai`][i] : null; };
const aiCodes = (run) => (run?.data ? arr(run.data.codes).filter((c) => c && doc.validSeg(c.seg)) : []);

// ---------------- 자동 저장 ----------------
const saveT = {};
const chain = {};
const dirty = new Set();
let inflight = 0;

function queueSave(section, delay = 900) {
  if (!me.joined) return;
  dirty.add(section);
  clearTimeout(saveT[section]);
  saveT[section] = setTimeout(() => { saveNow(section); }, delay);
  paintWho();
}
function saveNow(section) {
  clearTimeout(saveT[section]);
  if (!me.joined) return Promise.resolve();
  dirty.delete(section);
  const data = clone(S[section]);
  inflight += 1;
  paintWho();
  const p = (chain[section] || Promise.resolve())
    .then(() => api.post('/api/submit', { id: me.id, section, data }))
    .then((r) => { ui.savedAt = r.at || Date.now(); ui.saveErr = false; })
    .catch(() => {
      ui.saveErr = true;
      if (!dirty.has(section)) {
        dirty.add(section);
        saveT[section] = setTimeout(() => { saveNow(section); }, 4000);
      }
    })
    .finally(() => { inflight -= 1; paintWho(); });
  chain[section] = p;
  return p;
}
async function flushAll() {
  await Promise.all([...dirty].map(saveNow));
  await Promise.all(Object.values(chain));
}
// 다른 앱으로 넘어갈 때(검색하러 갈 때 등) 아직 안 보낸 칸을 바로 보낸다
function beaconAll() {
  if (!me.joined || !navigator.sendBeacon) return;
  for (const section of [...dirty]) {
    clearTimeout(saveT[section]);
    const body = new Blob([JSON.stringify({ id: me.id, section, data: S[section] })], { type: 'application/json' });
    if (navigator.sendBeacon('/api/submit', body)) dirty.delete(section);
    else saveNow(section);
  }
}
function clearSaves() {
  Object.keys(saveT).forEach((k) => clearTimeout(saveT[k]));
  dirty.clear();
}

// ---------------- 서버와 맞추기 ----------------
async function reloadMe() {
  const r = await api.get(`/api/me?id=${encodeURIComponent(me.id)}`);
  // 서버에 내가 없으면(발표자가 '모두 지우기'를 한 뒤) 이름 칸에 전 이름을 채워 두고 다시 들어오게 한다
  me.joined = !!r.me;
  if (r.me?.name) { me.name = r.me.name; store.set('dal-name', me.name); }
  S = fromServer(r.resp || {});
  ui.sel = { p1: -1, p2: -1 };
}

let pollT = null;
function schedulePoll(ms) {
  clearTimeout(pollT);
  pollT = setTimeout(poll, ms ?? (document.hidden ? 15000 : 3000));
}
async function poll() {
  clearTimeout(pollT);
  try {
    const t0 = Date.now();
    const st = await api.get('/api/state');
    offset = st.now - (t0 + Date.now()) / 2;
    if (!ui.net) { ui.net = true; paintWho(); }
    await applyState(st);
    if (ui.view === 'summary' && Date.now() - ui.boardAt > 8000) loadBoard();
  } catch {
    if (ui.net) { ui.net = false; paintWho(); }
  }
  schedulePoll();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) beaconAll();
  else if (ui.boot === 'ok') poll();
});
window.addEventListener('pagehide', beaconAll);

const typingNow = () => {
  const a = document.activeElement;
  return !!a && ['INPUT', 'TEXTAREA'].includes(a.tagName) && $('#task').contains(a) && Date.now() - ui.lastInput < 3000;
};

async function applyState(st) {
  const prev = cfg;
  cfg = st;
  if (!prev || prev.raw !== st.raw) doc = makeDoc(st.raw);

  if (me.joined && lastEpoch !== null && st.epoch !== lastEpoch) {
    lastEpoch = st.epoch;
    clearSaves();
    try { await reloadMe(); } catch { /* 다음 확인 때 다시 */ }
    ui.view = st.phase; ui.follow = true; ui.err = null; ui.board = null; ui.editName = false;
    render();
    toast(me.joined ? '발표자가 처음부터 다시 시작했어요.' : '발표자가 처음부터 다시 시작했어요. 이름을 확인하고 다시 들어와 주세요.');
    return;
  }
  lastEpoch = st.epoch;
  if (!prev) { render(); return; }

  if (prev.phase !== st.phase) {
    flushAll();
    ui.board = null;
    const behind = idx(ui.view) > idx(st.phase); // 발표자가 앞 단계로 되돌린 경우
    if ((ui.follow && !typingNow()) || behind || !me.joined) {
      goView(st.phase);
      if (me.joined && st.phase !== 'lobby') toast(`‘${PHASE_LABEL[st.phase]}’ 단계예요`);
    } else {
      ui.follow = false;
      render();
      toast('발표자가 다음 단계로 넘겼어요. 다 쓰면 위의 ‘지금 단계로’를 눌러요.');
    }
    return;
  }
  const keysChanged = ['raw', 'aiEnabled', 'maxRuns', 'sourceFull', 'sourceShort', 'defaultRQ', 'scope', 'showNames', 'aiMode']
    .some((k) => prev[k] !== st[k]);
  if (keysChanged) render();
  else paintHeader();
}

async function loadBoard() {
  if (ui.boardLoading) return;
  ui.boardLoading = true;
  try {
    ui.board = await api.get('/api/board');
    ui.boardAt = Date.now();
    const c = $('#classCard');
    if (c && ui.view === 'summary') c.replaceWith(classCard());
  } catch { /* 다음에 다시 */ } finally {
    ui.boardLoading = false;
  }
}

// ---------------- 머리 ----------------
function paintHeader() {
  $('#phaseBadge').textContent = cfg ? (PHASE_LABEL[cfg.phase] || '…') : '…';
  paintClock();
  paintWho();
  document.documentElement.style.setProperty('--topH', `${$('#top').offsetHeight}px`);
}
function paintClock() {
  const c = $('#clock');
  if (!cfg) { c.textContent = ''; return; }
  const left = remaining(cfg, offset);
  c.textContent = clockText(left);
  c.classList.toggle('over', left != null && left <= 0);
}
function paintWho() {
  const w = $('#who');
  if (!me.joined) { fill(w); return; }
  let sv = null;
  if (!ui.net) sv = ['연결 끊김', 'bad'];
  else if (dirty.size || inflight) sv = ['저장 중…', ''];
  else if (ui.saveErr) sv = ['저장 안 됨', 'bad'];
  else if (ui.savedAt) sv = ['저장됨', 'ok'];
  fill(w, h('span', { text: me.name }), sv ? h('span', { class: `sv ${sv[1]}`, text: `· ${sv[0]}` }) : null);
}

// ---------------- 단계 띠 ----------------
function isDone(id) {
  switch (id) {
    case 'p1_human': return S.p1.lines.length > 0 && !!str(S.p1.sentence);
    case 'p1_ai': return S.p1ai.length > 0;
    case 'p1_compare': return !!(S.p1cmp.who || str(S.p1cmp.word));
    case 'explain': return !!ui.seen.explain || idx(cfg.phase) > idx('explain');
    case 'p2_source': return srcFilled();
    case 'p2_human': return S.p2.codes.some((c) => str(c.code)) && !!str(S.p2.sentence);
    case 'p2_ai': return S.p2ai.length > 0;
    case 'p2_compare': return ['context', 'coding', 'verify', 'voice'].some((k) => S.p2cmp[k]);
    default: return false;
  }
}
function renderSteps() {
  const band = $('#stepsBand');
  const show = !!cfg && me.joined && !ui.editName && cfg.phase !== 'lobby';
  band.hidden = !show;
  if (!show) return;
  const now = idx(cfg.phase);
  const box = $('#steps');
  let prev = null;
  box.replaceChildren(...STEP_IDS.map((id) => {
    const m = STEP_META[id];
    const b = h('button', {
      type: 'button',
      class: `st${id === ui.view ? ' on' : ''}${id === cfg.phase ? ' now' : ''}${isDone(id) ? ' done' : ''}${prev && prev !== m.group ? ' gs' : ''}`,
      disabled: idx(id) > now,
      'aria-current': id === ui.view ? 'step' : null,
      onclick: () => goView(id),
    }, h('small', { text: m.group }), h('span', { text: m.name }));
    prev = m.group;
    return b;
  }));
  if (ui.centered !== ui.view) {
    ui.centered = ui.view;
    const on = box.querySelector('.st.on');
    if (on) {
      const br = box.getBoundingClientRect();
      const r = on.getBoundingClientRect();
      box.scrollLeft += (r.left - br.left) - (br.width - r.width) / 2;
    }
  }
}
function goView(id) {
  ui.view = id;
  ui.follow = !cfg || id === cfg.phase;
  ui.err = null;
  ui.docOpen = !narrow() || HUMAN_VIEWS.includes(id);
  if (id === 'explain') ui.seen.explain = true;
  render();
  if (id === 'summary' && Date.now() - ui.boardAt > 3000) loadBoard();
  const lay = $('#layout');
  const y = lay.getBoundingClientRect().top + window.scrollY - ($('#top').offsetHeight + 8);
  if (window.scrollY > y) window.scrollTo({ top: Math.max(0, y) });
}

// ---------------- 문서 ----------------
function toggleP1(k) {
  const a = S.p1.lines;
  const i = a.indexOf(k);
  if (i >= 0) a.splice(i, 1);
  else {
    if (a.length >= 2) { toast('2개까지 고를 수 있어요. 하나를 빼고 골라 주세요.', true); return; }
    a.push(k);
    a.sort((x, y) => x - y);
  }
  queueSave('p1', 300);
  renderDoc(); renderTask(); renderSteps();
}
function toggleSeg(seg) {
  const i = S.p2.codes.findIndex((c) => c.seg === seg);
  if (i >= 0) S.p2.codes.splice(i, 1);
  else {
    if (S.p2.codes.length >= MAX_CODES) { toast(`${MAX_CODES}문장까지 코딩할 수 있어요.`, true); return; }
    S.p2.codes.push({ seg, code: '' });
    S.p2.codes.sort((a, b) => segSort(a.seg, b.seg));
  }
  queueSave('p2', 300);
  renderDoc(); renderTask(); renderSteps();
  if (i < 0) { const inp = document.getElementById(`code-${seg}`); if (inp) inp.focus(); }
}
function paraMarks() {
  const r1 = curRun('p1');
  if (ui.view === 'p1_human') return { me: S.p1.lines, ai: [], pick: true };
  if (ui.view === 'p1_ai' || ui.view === 'p1_compare') return { me: S.p1.lines, ai: r1 ? arr(r1.data.lines) : [] };
  return { me: [], ai: [] };
}
function docParagraphs(ls) {
  const m = paraMarks();
  const list = h('ol', { class: 'lines' }, ls.map((l) => {
    if (l.gap) return h('li', { class: 'gap', 'aria-label': '건너뜀', text: '(…)' });
    if (l.head) return h('li', { class: 'hd', text: l.text });
    const isMe = m.me.includes(l.n);
    const isAi = m.ai.includes(l.n);
    const li = h('li', { class: `line${isMe ? ' me' : ''}${isAi ? ' ai' : ''}${m.pick ? ' pick' : ''}` },
      h('span', { class: 'num', text: circ(l.n) }),
      h('span', { class: 'body' },
        h('span', { class: 't' }, h('span', { class: 'u', text: l.text })),
        isMe || isAi ? h('span', { class: 'tags' },
          isMe ? h('span', { class: 'tg me', text: '나' }) : null,
          isAi ? h('span', { class: 'tg ai', text: 'AI' }) : null) : null));
    if (m.pick) {
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-pressed', String(isMe));
      li.setAttribute('aria-label', `${l.n}번 ${U()}`);
      li.addEventListener('click', () => toggleP1(l.n));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleP1(l.n); } });
    }
    return li;
  }));
  const legend = m.pick
    ? h('div', { class: 'legend' }, h('span', { class: 'me' }, h('span', { class: 'sw', text: '밑줄' }), ` ${U()}을 누르면 그어져요 · 2개까지`))
    : (m.me.length || m.ai.length)
      ? h('div', { class: 'legend' },
        h('span', { class: 'me' }, h('span', { class: 'sw', text: '밑줄' }), ` 내가 고른 ${U()}`),
        h('span', { class: 'ai' }, h('span', { class: 'sw', text: '물결' }), ` AI가 고른 ${U()}`))
      : null;
  return [list, legend];
}
function codeRow(c) {
  const inp = h('input', {
    type: 'text', id: `code-${c.seg}`, placeholder: '코드: 무엇의 증거인가', autocomplete: 'off', maxlength: 60, 'aria-label': `${segLabel(c.seg)} 코드`,
  });
  inp.value = c.code;
  inp.addEventListener('input', () => {
    c.code = inp.value;
    ui.lastInput = Date.now();
    queueSave('p2');
    renderSteps();
    paintDone();
    const v = inp.value.trim();
    const tag = document.getElementById(`ctag-${c.seg}`);
    if (tag) { tag.textContent = v || '코드?'; tag.classList.toggle('empty', !v); }
    const chip = document.getElementById(`sum-${c.seg}`);
    if (chip && chip.lastChild) { chip.lastChild.textContent = v || '코드 아직'; chip.lastChild.className = v ? '' : 'muted'; }
  });
  return h('div', { class: 'coderow' },
    h('span', { class: 'lp me', text: segLabel(c.seg) }),
    inp,
    h('button', { type: 'button', class: 'mini', onclick: () => toggleSeg(c.seg), text: '빼기' }));
}
function docSentences(ls) {
  const pick = ui.view === 'p2_human';
  const showAI = !pick;
  const mine = new Map(S.p2.codes.map((c) => [c.seg, str(c.code)]));
  const ai = new Map(showAI ? aiCodes(curRun('p2')).map((c) => [c.seg, c.code]) : []);
  const list = h('ol', { class: 'lines' }, ls.map((l) => {
    if (l.gap) return h('li', { class: 'gap', 'aria-label': '건너뜀', text: '(…)' });
    if (l.head) return h('li', { class: 'hd', text: l.text });
    const sents = l.sents.map((s, j) => {
      const seg = `${l.n}-${j + 1}`;
      const isMe = mine.has(seg);
      const isAi = ai.has(seg);
      const tag = isMe ? h('span', { class: `ctag me${mine.get(seg) ? '' : ' empty'}`, id: `ctag-${seg}`, text: mine.get(seg) || '코드?' }) : null;
      const sp = h('span', { class: `sent${isMe ? ' me' : ''}${isAi ? ' ai' : ''}${pick ? ' pick' : ''}`, id: `s-${seg}` },
        h('span', { class: 't' }, h('span', { class: 'u', text: s })),
        h('sup', { class: 'sid', text: String(j + 1) }),
        tag,
        isAi ? h('span', { class: 'ctag ai', text: ai.get(seg) || '—' }) : null);
      if (pick) {
        sp.tabIndex = 0;
        sp.setAttribute('role', 'button');
        sp.setAttribute('aria-pressed', String(isMe));
        sp.setAttribute('aria-label', `${segLabel(seg)} 문장`);
        sp.addEventListener('click', () => toggleSeg(seg));
        sp.addEventListener('keydown', (e) => { if (e.target === sp && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSeg(seg); } });
        if (tag) tag.addEventListener('click', (e) => { e.stopPropagation(); const inp = document.getElementById(`code-${seg}`); if (inp) inp.focus(); });
      }
      return [sp, ' '];
    });
    const rows = pick ? S.p2.codes.filter((c) => segParts(c.seg)[0] === l.n) : [];
    return h('li', { class: 'line' },
      h('span', { class: 'num', text: circ(l.n) }),
      h('div', { class: 'body' }, h('p', { class: 'para' }, sents), rows.length ? h('div', { class: 'coderows' }, rows.map(codeRow)) : null));
  }));
  const legend = h('div', { class: 'legend' },
    pick
      ? h('span', { class: 'me' }, h('span', { class: 'sw', text: '밑줄' }), ' 문장을 누르면 아래에 코드 칸이 생겨요 · 작은 숫자는 문장 번호')
      : h('span', { class: 'me' }, h('span', { class: 'sw', text: '밑줄' }), ' 내가 코딩한 문장'),
    showAI ? h('span', { class: 'ai' }, h('span', { class: 'sw', text: '물결' }), ' AI가 코딩한 문장') : null);
  return [list, legend];
}
function renderDoc() {
  const box = $('#doc');
  if (box.hidden || !cfg) return;
  const ls = doc.lines;
  const sentMode = SENT_VIEWS.includes(ui.view);
  const meta = sentMode
    ? `칼럼 ${scopeWord(cfg)} · ${doc.count}${U()} · 문장 ${doc.sents}개`
    : `칼럼 ${scopeWord(cfg)} · ${doc.count}${U()}`;
  const head = h('div', { class: 'doc-top' },
    h('span', { class: 'kicker', text: '문서' }),
    h('span', { class: 'doc-src' }, cfg.sourceFull || '', ls.length ? h('span', {}, ' · ', h('b', { text: meta })) : null),
    ls.length ? h('button', {
      type: 'button', class: 'linkbtn', 'aria-expanded': String(ui.docOpen),
      onclick: () => { ui.docOpen = !ui.docOpen; renderDoc(); }, text: ui.docOpen ? '접기' : '펼치기',
    }) : null);
  if (!ls.length) {
    box.replaceChildren(h('section', { class: 'doc-card' }, head,
      h('p', { class: 'doc-empty', text: '발표자가 본문을 올리면 여기에 번호가 붙어 나와요.' })));
    return;
  }
  const [list, legend] = sentMode ? docSentences(ls) : docParagraphs(ls);
  box.replaceChildren(h('section', { class: `doc-card${ui.docOpen ? '' : ' folded'}` }, head, list, legend));
}

// ---------------- 공통 조각 ----------------
function stepHead(id, title, lead) {
  const m = STEP_META[id];
  const min = PHASE_MIN[id];
  return h('header', { class: 'head' },
    h('div', { class: 'eyebrow' }, `${m.group} · ${m.name}`, min ? h('span', { class: 'mins', text: ` · ${fmtMin(min)}` }) : null),
    h('h2', { text: title }),
    lead ? h('p', { class: 'lead', text: lead }) : null);
}
function renderBack() {
  const box = $('#backWrap');
  const show = !!cfg && me.joined && !ui.editName && ui.view !== cfg.phase;
  box.hidden = !show;
  if (!show) { fill(box); return; }
  fill(box, h('div', { class: 'backbar', role: 'status' },
    h('span', {}, '지금 수업은 ', h('b', { text: PHASE_LABEL[cfg.phase] }), ' 단계예요.'),
    h('button', { type: 'button', class: 'mini', onclick: () => goView(cfg.phase), text: '지금 단계로 →' })));
}
const DONE_TEXT = ['적는 대로 자동 저장돼요.', '✓ 다 했어요. 다음 단계는 발표자가 넘겨요.'];
const doneNote = (done) => h('p', { class: `done-note${done ? ' ok' : ''}`, id: 'doneNote', text: DONE_TEXT[done ? 1 : 0] });
function paintDone() {
  const e = $('#doneNote');
  if (!e || !cfg) return;
  const done = isDone(ui.view);
  e.textContent = DONE_TEXT[done ? 1 : 0];
  e.classList.toggle('ok', done);
}
function field(id, label, hint, value, onInput, { kind = 'input', ph = '', rows = 3, max = 300 } = {}) {
  const ctrl = kind === 'textarea'
    ? h('textarea', { id, rows, placeholder: ph || null, maxlength: max })
    : h('input', { id, type: 'text', placeholder: ph || null, autocomplete: 'off', maxlength: max });
  ctrl.value = value || '';
  ctrl.addEventListener('input', () => { ui.lastInput = Date.now(); onInput(ctrl.value); });
  return h('label', { class: 'field', for: id },
    h('span', { class: 'label', text: label }),
    hint ? h('span', { class: 'hint', text: hint }) : null,
    ctrl);
}
const upd = (section, fn) => (v) => { fn(v); queueSave(section); renderSteps(); paintDone(); };
function qhead(no, title, sub) {
  return h('div', { class: 'qh' }, h('span', { class: 'qn', text: no }), h('div', {}, h('h3', { text: title }), sub ? h('p', { text: sub }) : null));
}
function lineChips(id, picked, onToggle) {
  return h('div', { class: 'chips', role: 'group', 'aria-label': `${U()} 번호` },
    range(doc.count).map((k) => h('button', {
      type: 'button', class: 'lc', id: `${id}-${k}`, 'aria-pressed': String(picked.includes(k)),
      'aria-label': `${k}번 ${U()}`, onclick: () => onToggle(k), text: circ(k),
    })));
}
const linePills = (list, w) => (list && list.length
  ? h('span', { class: 'lps' }, list.map((n) => h('span', { class: `lp ${w}`, text: circ(n) })))
  : h('span', { class: 'muted small', text: `고른 ${U()} 없음` }));
function snips(nums) {
  if (!nums.length) return null;
  return h('ul', { class: 'snips' }, nums.map((n) => h('li', {}, h('span', { class: 'lp ghost', text: circ(n) }), h('span', { class: 's', text: doc.textOf(n) }))));
}
function pair(a, b, la = '나', lb = 'AI') {
  const box = (cls, label, c) => {
    const empty = c == null || c === '';
    return h('div', { class: `box ${cls}${empty ? ' empty' : ''}` },
      h('small', { text: label }),
      empty ? h('span', { class: 'v', text: '아직 없음' }) : (typeof c === 'string' ? h('span', { class: 'v', text: c }) : c));
  };
  return h('div', { class: 'pair' }, box('me', la, a), box('ai', lb, b));
}
function segmented(id, value, set, section) {
  return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '해낸 쪽' },
    CHECK.map(([v, label]) => h('button', {
      type: 'button', role: 'radio', class: v, id: `${id}-${v}`, 'aria-checked': value === v ? 'true' : 'false',
      onclick: () => { set(value === v ? '' : v); queueSave(section, 300); renderTask(); renderSteps(); }, text: label,
    })));
}
function needDoc() {
  if (doc.count >= 2) return null;
  return h('section', { class: 'card notice' },
    h('p', { text: '아직 본문이 올라오지 않았어요. 발표자가 올리면 저절로 나타나요.' }));
}

// ---------------- AI ----------------
const pendingLabel = () => {
  if (!pending) return '';
  const s = Math.round((Date.now() - pending.t0) / 1000);
  return s < 2 ? 'AI에게 보내는 중…' : `AI가 읽고 쓰는 중… ${s}초`;
};
async function runAI(kind, withSrc = false) {
  if (pending || !me.joined) return;
  ui.err = null;
  pending = { kind, t0: Date.now(), iv: null };
  pending.iv = setInterval(() => { const e = $('#pendingText'); if (e) e.textContent = pendingLabel(); }, 1000);
  renderTask();
  try {
    await flushAll(); // 연구 질문·출처를 먼저 저장해야 서버가 그걸로 묻는다
    const r = await api.post('/api/analyze', { id: me.id, stage: kind, withSrc });
    S[`${kind}ai`] = arr(r.runs).filter((x) => x && x.data);
    ui.sel[kind] = S[`${kind}ai`].length - 1;
    toast(`AI ${S[`${kind}ai`].length}회차 답이 왔어요 · ${secs(r.run?.ms)}초`);
  } catch (e) {
    ui.err = { kind, msg: e.status === 504 ? 'AI 답이 너무 늦어요. 한 번 더 눌러 주세요.' : (e.message || 'AI를 부르지 못했어요. 한 번 더 눌러 주세요.') };
  } finally {
    clearInterval(pending.iv);
    pending = null;
    renderDoc(); renderTask(); renderSteps();
  }
}
function givenBox(kind) {
  const named = authorName() && str(cfg.sourceShort).includes(authorName());
  const model = `${cfg.model || ''}${cfg.aiMode === 'mock' ? ' · 테스트 모드' : ''}`;
  const items = kind === 'p1'
    ? [['본문', `칼럼 ${scopeWord(cfg)}, 번호가 붙은 ${doc.count}${U()}`], ['출처 한 줄', `‘${cfg.sourceShort || '—'}’`], ['과제', `사람과 같아요. 중요한 ${U()} 1~2개와 한 문장`], ['모델', model]]
    : [['본문', `1차와 같은 글, 문장마다 [${U()}-문장] 번호`], ['출처 한 줄', `‘${cfg.sourceShort || '—'}’`], ['연구 질문', `‘${rq()}’`], ['과제', '사람과 같은 다시 코딩 · 확인할 것 · 한 문장, 그리고 누가·누구에게·왜·언제'], ['모델', model]];
  return h('div', { class: 'given' },
    h('div', { class: 'given-h', text: 'AI가 받는 것' }),
    h('dl', {}, items.map(([a, b]) => [h('dt', { text: a }), h('dd', { text: b })])),
    h('p', { class: 'given-no', text: kind === 'p1'
      ? `검색은 못 해요.${named ? '' : ' 필자 이름도 받지 않아요.'}`
      : '검색은 못 해요. 내가 찾은 출처·자료는 ‘같이 줘 보기’를 누를 때만 받아요.' }));
}
function promptBox(kind) {
  return h('details', { class: 'prompt', open: ui.openPrompt[kind] ? true : null, ontoggle: (e) => { ui.openPrompt[kind] = e.currentTarget.open; } },
    h('summary', { text: 'AI에게 보내는 질문 보기' }),
    h('pre', { text: buildPrompt(kind, cfg, doc, rq(), null) }),
    h('p', { class: 'hint', text: kind === 'p1'
      ? '답은 화면에 나눠 보여 주려고 정해진 칸(번호 · 까닭 · 한 문장)에 맞춰 받아요.'
      : '답은 화면에 나눠 보여 주려고 정해진 칸(① ~ ④)에 맞춰 받아요.' }));
}
function aiHint(kind, runs, open, left) {
  const mock = cfg.aiMode === 'mock' ? ' 지금은 테스트 모드라 실제 AI 대신 예시 답이 나와요.' : '';
  if (!cfg.aiEnabled) return '지금은 AI가 꺼져 있어요. 발표자가 켜면 돌릴 수 있어요.';
  if (!open) return kind === 'p1' ? 'AI는 실습 1의 ‘AI에게’와 ‘비교’ 시간에 돌릴 수 있어요.' : 'AI는 재실습의 ‘AI에게’와 ‘비교’ 시간에 돌릴 수 있어요.';
  if (doc.count < 2) return '본문이 올라오면 돌릴 수 있어요.';
  if (left <= 0) return `이 단계에서 AI는 ${cfg.maxRuns}번까지예요. 다 썼어요.`;
  if (!runs.length) {
    return `누르면 이 사이트의 Claude가 같은 본문을 읽어요. 20초 안팎 걸려요.${kind === 'p2' && srcFilled() ? ' 출처·자료를 적었다면 두 버튼을 하나씩 눌러 비교해 봐요.' : ''}${mock}`;
  }
  if (kind === 'p1') return `같은 질문을 다시 던지면 같은 답이 나올까요? ${left}번 더 돌릴 수 있어요.${mock}`;
  return `${srcFilled() ? '‘출처·자료도 같이’로 돌리면, 맥락을 찾아 AI에게 건네는 일도 사람 몫이라는 걸 볼 수 있어요. ' : ''}${left}번 더 돌릴 수 있어요.${mock}`;
}
function aiControls(kind, runs) {
  if (pending && pending.kind === kind) {
    return h('div', { class: 'wait' },
      h('span', { class: 'spin', 'aria-hidden': 'true' }),
      h('span', { id: 'pendingText', text: pendingLabel() }));
  }
  const open = OPEN_AI[kind].includes(cfg.phase);
  const left = cfg.maxRuns - runs.length;
  const ok = cfg.aiEnabled && open && doc.count >= 2 && left > 0 && !pending;
  const first = kind === 'p1' ? 'AI에게 맡기기' : '같은 틀로 AI에게';
  return h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', id: `go-${kind}`, disabled: !ok, onclick: () => runAI(kind), text: runs.length ? '한 번 더 돌려 보기' : first }),
      kind === 'p2' && srcFilled() ? h('button', {
        type: 'button', class: 'btn ghost', id: 'go-p2src', disabled: !ok, onclick: () => runAI('p2', true), text: '내가 찾은 출처·자료도 같이 줘 보기',
      }) : null),
    h('p', { class: 'hint', text: aiHint(kind, runs, open, left) }));
}
function runTabs(kind, runs) {
  const cur = sel(kind);
  return h('div', { class: 'runs', role: 'group', 'aria-label': 'AI 회차' },
    runs.map((r, i) => h('button', {
      type: 'button', class: 'mini', id: `run-${kind}-${i}`, 'aria-pressed': String(i === cur),
      onclick: () => { ui.sel[kind] = i; renderDoc(); renderTask(); },
      text: `${i + 1}회차${r.withSrc ? ' · 출처 함께' : ''}`,
    })));
}
const runMeta = (run, i, extra = '') => `${run.model || 'AI'} · ${i + 1}회차${extra} · 답까지 ${secs(run.ms)}초 · ${fmtTime(run.at)}`;
function p1Card(run, i) {
  const d = run.data;
  return h('article', { class: 'ai-card' },
    h('div', { class: 'meta', text: runMeta(run, i) }),
    h('div', { class: 'kv' }, h('b', { text: `고른 ${U()}` }), h('div', {}, linePills(arr(d.lines), 'ai'))),
    h('div', { class: 'kv' }, h('b', { text: '고른 까닭' }), h('p', { text: d.why || '—' })),
    h('blockquote', { class: 'quote ai' }, h('small', { text: 'AI의 한 문장' }), d.sentence || '—'),
    run.prompt ? h('details', { class: 'prompt' }, h('summary', { text: '이 회차에 보낸 질문' }), h('pre', { text: run.prompt })) : null);
}
function codeTable(codes, w) {
  const list = codes.filter((c) => c && doc.validSeg(c.seg)).sort((a, b) => segSort(a.seg, b.seg));
  if (!list.length) return h('p', { class: 'muted small', text: '코드 없음' });
  return h('div', { class: 'ctab' }, list.map((c) => h('div', { class: 'ctr' },
    h('span', { class: `lp ${w}`, text: segLabel(c.seg) }),
    h('span', { class: 's', text: doc.segText(c.seg) }),
    h('div', { class: 'cc2' }, h('span', { class: `cc ${w}`, text: str(c.code) || '코드 없음' })))));
}
function p2Card(run, i) {
  const d = run.data;
  return h('article', { class: 'ai-card' },
    h('div', { class: 'meta', text: runMeta(run, i, run.withSrc ? ' · 내가 찾은 출처·자료 함께' : '') }),
    h('div', { class: 'kv' }, h('b', {}, h('span', { class: 'qn sm', text: '①' }), ' 누가·누구에게·왜·언제'), h('p', { text: d.context || '—' })),
    h('div', { class: 'kv' }, h('b', {}, h('span', { class: 'qn sm', text: '②' }), ' 다시 코딩'), codeTable(aiCodes(run), 'ai')),
    h('div', { class: 'kv' }, h('b', {}, h('span', { class: 'qn sm', text: '③' }), ' 믿기 전에 확인할 것'),
      h('p', {}, d.criterion ? h('span', { class: 'crit', text: d.criterion }) : null, d.verify || '—')),
    h('blockquote', { class: 'quote ai' }, h('small', { text: '④ AI의 한 문장' }), d.sentence || '—'),
    run.prompt ? h('details', { class: 'prompt' }, h('summary', { text: '이 회차에 보낸 질문' }), h('pre', { text: run.prompt })) : null);
}
function aiPanel(kind) {
  const runs = S[`${kind}ai`];
  const i = sel(kind);
  const run = i >= 0 ? runs[i] : null;
  return h('section', { class: 'card' },
    givenBox(kind),
    promptBox(kind),
    aiControls(kind, runs),
    ui.err && ui.err.kind === kind ? h('div', { class: 'err', role: 'status', text: ui.err.msg }) : null,
    runs.length > 1 ? runTabs(kind, runs) : null,
    run ? (kind === 'p1' ? p1Card(run, i) : p2Card(run, i)) : null);
}

// ---------------- 화면: 입장 · 대기 ----------------
function flowCard() {
  return h('section', { class: 'card' },
    h('div', { class: 'kicker', text: '40분 흐름' }),
    h('h3', { text: '해 보고 · 배우고 · 다시 해 본다' }),
    flowBar(),
    h('ul', { class: 'flow-legend' },
      h('li', {}, h('b', { text: '실습 1 · 11분' }), '혼자 읽기 4분 · AI 3분 30초 · 비교 3분 30초'),
      h('li', {}, h('b', { text: '설명 · 7분' }), '다섯 질문 · 세 문서 · Scott · 볼 곳'),
      h('li', {}, h('b', { text: '재실습 · 14분 30초' }), '출처·자료 2분 · 다시 코딩 5분 · AI 3분 · 비교 4분 30초'),
      h('li', {}, h('b', { text: '정리 · 4분' }), 'AI와 연구자, 어디서 갈리나')));
}
async function submitJoin(name) {
  name = str(name).slice(0, 20);
  if (!name) { ui.joinErr = '이름을 적어 주세요.'; renderTask(); return; }
  ui.joining = true;
  ui.joinErr = '';
  renderTask();
  try {
    await api.post('/api/join', { id: me.id, name });
    const first = !me.joined;
    me.name = name;
    store.set('dal-name', name);
    if (first) await reloadMe();
    me.joined = true;
    ui.editName = false;
    ui.view = cfg.phase;
    ui.follow = true;
    ui.docOpen = !narrow() || HUMAN_VIEWS.includes(ui.view);
    toast(first ? `${name} 님, 반가워요.` : '이름을 바꿨어요.');
  } catch (e) {
    ui.joinErr = e.message;
  } finally {
    ui.joining = false;
    render();
  }
}
function viewJoin() {
  const inp = h('input', { type: 'text', id: 'joinName', maxlength: 20, placeholder: '예: 우엉', autocomplete: 'nickname', enterkeyhint: 'go' });
  inp.value = me.name || '';
  const form = h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); submitJoin(inp.value); } },
    h('div', { style: { flex: '1', minWidth: '160px' } }, inp),
    h('button', { class: 'btn', type: 'submit', id: 'joinBtn', disabled: ui.joining, text: ui.joining ? '들어가는 중…' : (me.joined ? '바꾸기' : '들어가기') }),
    me.joined ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { ui.editName = false; render(); }, text: '취소' }) : null);
  return h('div', { class: 'stack' },
    h('header', { class: 'head' },
      h('div', { class: 'eyebrow', text: '질적연구방법론 · 8장 문서분석 실습' }),
      h('h2', { text: '같은 칼럼을 나와 AI가 읽어요' }),
      h('p', { class: 'lead', text: '이름이나 별명을 적고 들어오세요. 로그인은 필요 없어요.' })),
    h('section', { class: 'card' },
      h('label', { class: 'field', for: 'joinName' },
        h('span', { class: 'label', text: '이름(별명)' }),
        h('span', { class: 'hint', text: cfg?.showNames ? '발표자 화면과 보드에 보여요.' : '발표자 화면에만 보여요. 보드에는 이름 없이 답만 모여요.' })),
      form,
      ui.joinErr ? h('p', { class: 'err', text: ui.joinErr }) : null),
    flowCard());
}
function viewLobby() {
  return h('div', { class: 'stack' },
    h('header', { class: 'head' },
      h('div', { class: 'eyebrow', text: '대기' }),
      h('h2', { text: '곧 시작해요' }),
      h('p', { class: 'lead', text: '발표자가 시작하면 이 화면이 저절로 넘어가요. 같은 칼럼을 나와 AI가 각각 읽고, 어디서 갈리는지 봐요.' })),
    h('section', { class: 'card' },
      h('div', { class: 'row' },
        h('span', {}, h('b', { text: me.name }), ' 이름으로 들어왔어요.'),
        h('button', { type: 'button', class: 'mini', onclick: () => { ui.editName = true; render(); }, text: '이름 바꾸기' })),
      h('ul', { class: 'notes' },
        h('li', { text: '적는 대로 자동 저장돼요. 화면을 닫았다가 다시 열어도 이어서 할 수 있어요.' }),
        h('li', { text: 'AI는 이 사이트 안의 Claude가 돌려요. 따로 로그인하지 않아도 돼요.' }),
        h('li', { text: cfg.showNames ? '답은 이름과 함께 발표자 화면과 보드에 모여요.' : '답은 발표자 화면에 모이고, 보드에는 이름 없이 모여요.' }))),
    flowCard());
}

// ---------------- 화면: 실습 1 ----------------
function viewP1Human() {
  const done = isDone('p1_human');
  return h('div', { class: 'stack' },
    stepHead('p1_human', '틀 없이, 먼저 읽어 보기', `평소 하던 대로 읽어요. 가장 중요한 ${U()}에 밑줄을 긋고, 이 문서가 무엇을 보여 주는지 한 문장으로 써요.`),
    needDoc() || [
      h('section', { class: 'card' },
        qhead('1', `가장 중요한 ${U()} 1~2개`, `문서의 ${U()}을 누르거나 아래 번호를 누르세요.`),
        lineChips('p1l', S.p1.lines, toggleP1),
        field('p1why', `왜 그 ${U()}? (선택, 한 줄)`, null, S.p1.why, upd('p1', (v) => { S.p1.why = v; }))),
      h('section', { class: 'card' },
        qhead('2', '이 문서는 무엇을 보여 주나? 한 문장으로'),
        field('p1sentence', '내 한 문장', null, S.p1.sentence, upd('p1', (v) => { S.p1.sentence = v; }), { kind: 'textarea', ph: '이 칼럼은 ________을 보여 준다.', rows: 3, max: 400 })),
      doneNote(done),
    ]);
}
function viewP1AI() {
  const notYet = !S.p1.lines.length && !str(S.p1.sentence);
  return h('div', { class: 'stack' },
    stepHead('p1_ai', 'AI에게 그냥 맡기면?', `같은 본문을 틀 없이 AI에게 줘요. 과제는 사람과 똑같이, 중요한 ${U()} 1~2개와 한 문장이에요.`),
    notYet ? h('div', { class: 'notice' },
      h('p', { text: '내 답을 아직 안 썼어요. AI 답을 보기 전에 먼저 써 두면 비교가 공정해요.' }),
      h('button', { type: 'button', class: 'mini', style: { marginTop: '8px' }, onclick: () => goView('p1_human'), text: '① 혼자 읽기로' })) : null,
    needDoc() || aiPanel('p1'),
    doneNote(isDone('p1_ai')));
}
function overlapText(m, a) {
  if (!m.length && !a.length) return `아직 고른 ${U()}이 없어요.`;
  const both = m.filter((n) => a.includes(n));
  const mo = m.filter((n) => !a.includes(n));
  const ao = a.filter((n) => !m.includes(n));
  const parts = [both.length ? `겹친 ${U()} ${both.map(circ).join(' ')}` : `겹친 ${U()} 없음`];
  if (mo.length) parts.push(`나만 ${mo.map(circ).join(' ')}`);
  if (ao.length) parts.push(`AI만 ${ao.map(circ).join(' ')}`);
  return parts.join(' · ');
}
function viewP1Compare() {
  const run = curRun('p1');
  const ai = run ? arr(run.data.lines) : [];
  return h('div', { class: 'stack' },
    stepHead('p1_compare', '나와 AI, 무엇이 같고 달랐나', `고른 ${U()}과 한 문장을 나란히 놓고, 아래 두 가지만 남겨요.`),
    run ? null : h('p', { class: 'notice', text: 'AI 답이 아직 없어요. 이 단계에서도 AI를 돌릴 수 있어요. 위 단계 띠의 ‘② AI에게’로 가 보세요.' }),
    S.p1ai.length > 1 ? runTabs('p1', S.p1ai) : null,
    h('section', { class: 'card' },
      h('h3', { text: `고른 ${U()}` }),
      pair(
        h('span', {}, linePills(S.p1.lines, 'me'), str(S.p1.why) ? h('span', { class: 'note', text: S.p1.why }) : null),
        run ? h('span', {}, linePills(ai, 'ai'), run.data.why ? h('span', { class: 'note', text: run.data.why }) : null) : null),
      h('p', { class: 'overlap', text: overlapText(S.p1.lines, ai) }),
      snips(uniq([...S.p1.lines, ...ai]))),
    h('section', { class: 'card' },
      h('h3', { text: '한 문장' }),
      pair(str(S.p1.sentence) || null, run ? run.data.sentence : null),
      S.p1ai.length > 1 ? h('details', { class: 'prompt' },
        h('summary', { text: `AI가 돌릴 때마다 쓴 문장 ${S.p1ai.length}개 · 같은 질문, 다른 답?` }),
        h('ol', { class: 'decide-list' }, S.p1ai.map((r) => h('li', { text: r.data.sentence })))) : null),
    h('section', { class: 'card' },
      qhead('?', '‘누가·왜 썼나’까지 읽은 쪽은?', '둘 다 문서에 담긴 내용만 읽었나, 누가 왜 썼는지까지 읽었나.'),
      segmented('p1who', S.p1cmp.who, (v) => { S.p1cmp.who = v; }, 'p1cmp'),
      field('p1word', '무엇이 달랐나, 한 단어', '예: 맥락 · 목소리 · 초점 · 감정', S.p1cmp.word, upd('p1cmp', (v) => { S.p1cmp.word = v; }), { max: 40 })),
    doneNote(isDone('p1_compare')));
}

// ---------------- 화면: 설명 ----------------
const dl = (rows) => h('dl', { class: 'crit-list' }, rows.map(([a, b]) => [h('dt', { text: a }), h('dd', { text: b })]));
function frameCards() {
  return h('div', { class: 'frame' },
    h('section', { class: 'card' },
      h('div', { class: 'kicker', text: '다섯 질문' }),
      h('h3', { text: '문서를 만나면 묻는 것' }),
      h('div', { class: 'five' },
        h('div', {}, h('small', { text: '문서가 만들어진 맥락' }), h('div', { class: 'tok' }, ['누가', '누구에게', '왜', '언제'].map((t) => h('span', { text: t })))),
        h('div', {}, h('small', { text: '연구자가 쓰는 맥락' }), h('div', { class: 'tok' }, h('span', { class: 'acc', text: '무엇의 증거로' })))),
      h('p', { class: 'hint', text: '재실습에서 앞의 넷은 ‘출처·자료 2분’에서, 무엇의 증거로는 ‘다시 코딩’에서 문장마다 코드로 답해요.' })),
    h('section', { class: 'card' },
      h('div', { class: 'kicker', text: 'Scott (1990)' }),
      h('h3', { text: '믿기 전에 확인할 네 가지' }),
      dl([['진정성', '진짜인가, 출처가 분명한가, 어느 판본인가'], ['신빙성', '오류나 왜곡은 없나, 저자의 이해관계는'], ['대표성', '전형적인가, 한 사람만의 목소리인가'], ['의미', '맥락 속에서 뜻이 분명한가']])),
    h('section', { class: 'card' },
      h('div', { class: 'kicker', text: '재실습에서 볼 곳' }),
      h('h3', { text: 'AI와 연구자, 어디를 볼까' }),
      dl([['맥락', '출처·매체까지 짚나?'], ['목적', '연구 질문이 코딩을 바꾸나?'], ['검증', '원문에 없는 말을 하나?'], ['표현', '누구의 목소리로 쓰나?'], ['책임', '이 해석에 누가 서명하나?']])));
}
function viewExplain() {
  return h('div', { class: 'stack' },
    stepHead('explain', '무엇이 빠졌나, 무엇을 들고 갈까', '발표자가 이 틀을 슬라이드로 설명해요. 재실습 때 다시 펼쳐 볼 수 있어요.'),
    frameCards());
}

// ---------------- 화면: 재실습 ----------------
function xRow(x, i) {
  const name = h('input', { type: 'text', id: `xName-${i}`, placeholder: '자료 이름이나 링크', autocomplete: 'off', maxlength: 300, 'aria-label': `추가 자료 ${i + 1} 이름` });
  name.value = x.name;
  name.addEventListener('input', () => { x.name = name.value; ui.lastInput = Date.now(); queueSave('src'); renderSteps(); paintDone(); });
  const note = h('input', { type: 'text', id: `xNote-${i}`, class: 'xnote', placeholder: '이 자료가 해석에 보태는 것', autocomplete: 'off', maxlength: 300, 'aria-label': `추가 자료 ${i + 1} 설명` });
  note.value = x.note;
  note.addEventListener('input', () => { x.note = note.value; ui.lastInput = Date.now(); queueSave('src'); renderSteps(); paintDone(); });
  return h('div', { class: 'xrow' }, name, note,
    h('button', { type: 'button', class: 'mini xdel', onclick: () => { S.src.extras.splice(i, 1); queueSave('src', 300); renderTask(); renderSteps(); }, text: '빼기' }));
}
function addExtra() {
  if (S.src.extras.length >= MAX_EXTRAS) return;
  S.src.extras.push({ name: '', note: '' });
  renderTask();
  const e = document.getElementById(`xName-${S.src.extras.length - 1}`);
  if (e) e.focus();
}
function viewP2Source() {
  const d = docDate();
  const gq = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const queries = [authorName() ? `${authorName()} 교사` : null, `${outletName()} 발행`, d ? `${d.words} 학교` : null].filter(Boolean);
  return h('div', { class: 'stack' },
    stepHead('p2_source', '먼저 2분, 출처와 추가 자료', '휴대폰으로 찾아보고 적어요. 다섯 질문 가운데 누가·누구에게·왜·언제는 여기서 답해요. 해석을 도울 자료를 찾았다면 아래에 남겨요. AI는 이 단계를 하지 않아요.'),
    h('section', { class: 'card' },
      qhead('⓪', '누가 · 누구에게 · 언제 · 왜'),
      field('srcAuthor', '누가: 필자는 누구인가?', null, S.src.author, upd('src', (v) => { S.src.author = v; }), { max: 200 }),
      field('srcOutlet', '누구에게: 실린 곳은 어떤 매체이고, 누가 읽나?', null, S.src.outlet, upd('src', (v) => { S.src.outlet = v; }), { max: 200 }),
      field('srcDay', d ? `언제: 그날(${d.label})은 어떤 날이었나?` : '언제: 글이 실린 날은 어떤 날이었나?', null, S.src.day, upd('src', (v) => { S.src.day = v; }), { max: 200 }),
      field('srcWhy', '왜: 그래서 왜 썼을까?', null, S.src.why, upd('src', (v) => { S.src.why = v; }), { ph: '한 줄', max: 300 }),
      h('div', { class: 'links' }, h('span', { class: 'hint', text: '찾아보기' }),
        queries.map((q) => h('a', { href: gq(q), target: '_blank', rel: 'noopener', text: q })))),
    h('section', { class: 'card' },
      qhead('+', '해석을 돕는 추가 자료', `같은 사건을 다룬 다른 문서, 본문의 주장을 확인할 자료처럼 해석에 보탬이 될 것. 최대 ${MAX_EXTRAS}개`),
      S.src.extras.length ? h('div', { class: 'stack' }, S.src.extras.map(xRow)) : h('p', { class: 'hint', text: '아직 없어요.' }),
      S.src.extras.length < MAX_EXTRAS ? h('button', { type: 'button', class: 'mini', id: 'xAdd', onclick: addExtra, text: '+ 자료 더하기' }) : null),
    doneNote(isDone('p2_source')));
}
function critChips(id, value, set) {
  return h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Scott의 준거' },
    CRIT.map((c) => h('button', {
      type: 'button', role: 'radio', class: 'mini', id: `${id}-${c}`, 'aria-pressed': String(value === c), 'aria-checked': String(value === c),
      onclick: () => { set(value === c ? '' : c); queueSave('p2', 300); renderTask(); }, text: c,
    })));
}
function viewP2Human() {
  const codes = [...S.p2.codes].sort((a, b) => segSort(a.seg, b.seg));
  const filled = codes.filter((c) => str(c.code)).length;
  const start = S.p1.lines.length ? ` 1차에 고른 ${U()} ${S.p1.lines.map(circ).join(' ')}에서 시작해도 좋아요.` : '';
  return h('div', { class: 'stack' },
    stepHead('p2_human', '같은 칼럼, 문장 단위로 다시 코딩', `이번에는 내 연구 질문을 들고 ${U()} 안을 문장으로 끊어 읽어요. 문서에서 문장을 누르면 그 아래에 코드 칸이 생겨요.`),
    needDoc() || [
      h('details', { class: 'card soft frame-mini' },
        h('summary', { text: '틀 다시 보기' }),
        h('p', {}, h('b', { text: '다섯 질문 ' }), '누가 · 누구에게 · 왜 · 언제는 앞 단계에서, 무엇의 증거로는 여기서 코드로 답해요.'),
        h('p', {}, h('b', { text: 'Scott ' }), '진정성 · 신빙성 · 대표성 · 의미')),
      h('section', { class: 'card' },
        field('rq', '먼저, 내 연구 질문 한 줄', `비워 두면 ‘${cfg.defaultRQ}’로 해요.`, S.p2.rq, upd('p2', (v) => { S.p2.rq = v; }), { ph: cfg.defaultRQ, max: 300 })),
      h('section', { class: 'card' },
        qhead('①', '다시 코딩', '내 연구 질문에 비추어, 이 문장은 무엇의 증거인가? 문장 3개 이상에 짧은 코드를 붙여요.'),
        codes.length ? h('div', { class: 'codelist' }, codes.map((c) => h('span', { class: 'codechip', id: `sum-${c.seg}` },
          h('b', { text: segLabel(c.seg) }),
          h('span', { class: str(c.code) ? '' : 'muted', text: str(c.code) || '코드 아직' })))) : null,
        h('p', { class: 'hint', text: codes.length
          ? `${codes.length}문장 고름 · 코드 ${filled}개. 문장을 다시 누르면 빠져요.`
          : `${narrow() ? '위' : '왼쪽'} 문서에서 문장을 눌러 보세요.${start}` })),
      h('section', { class: 'card' },
        qhead('②', '믿기 전에 확인할 것', '진정성 · 신빙성 · 대표성 · 의미 가운데 하나'),
        critChips('p2crit', S.p2.crit, (v) => { S.p2.crit = v; }),
        field('p2verify', '무엇을, 어떻게 확인할까', null, S.p2.verify, upd('p2', (v) => { S.p2.verify = v; }), { kind: 'textarea', rows: 2, max: 600 })),
      h('section', { class: 'card' },
        qhead('③', '한 문장으로 다시 쓰기', '코드를 묶어 보면, 1차 문장과 무엇이 달라지나'),
        str(S.p1.sentence) ? h('blockquote', { class: 'quote' }, h('small', { text: '1차 내 문장' }), S.p1.sentence) : null,
        field('p2sentence', '다시 쓴 한 문장', null, S.p2.sentence, upd('p2', (v) => { S.p2.sentence = v; }), { kind: 'textarea', ph: '이 칼럼은 ________을 보여 준다.', rows: 3, max: 400 })),
      doneNote(isDone('p2_human')),
    ]);
}
function viewP2AI() {
  const notYet = !S.p2.codes.length && !str(S.p2.sentence);
  return h('div', { class: 'stack' },
    stepHead('p2_ai', '같은 틀을 AI에게도', '내 연구 질문과 같은 과제를 그대로 줘요. AI는 문장을 몇 개나, 어떤 코드로 묶을까요?'),
    notYet ? h('div', { class: 'notice' },
      h('p', { text: '다시 코딩을 아직 안 했어요. 내 코드를 먼저 붙여 두면 비교가 공정해요.' }),
      h('button', { type: 'button', class: 'mini', style: { marginTop: '8px' }, onclick: () => goView('p2_human'), text: '① 다시 코딩으로' })) : null,
    needDoc() || aiPanel('p2'),
    doneNote(isDone('p2_ai')));
}
const withCrit = (c, text) => (c || text ? h('span', {}, c ? h('span', { class: 'crit', text: c }) : null, text || '') : null);
const beforeAfter = (a, b) => (a || b ? h('span', { class: 'ba' },
  h('span', {}, h('small', { text: '1차' }), a || '—'),
  h('span', {}, h('small', { text: '재실습' }), b || '—')) : null);
function codeCompare(d) {
  const mine = new Map(S.p2.codes.map((c) => [c.seg, str(c.code)]));
  const ai = new Map(d ? arr(d.codes).filter((c) => c && c.seg).map((c) => [c.seg, str(c.code)]) : []);
  const segs = [...new Set([...mine.keys(), ...ai.keys()])].filter(doc.validSeg).sort(segSort);
  if (!segs.length) return pair(null, null);
  const both = segs.filter((s) => mine.has(s) && ai.has(s));
  const mo = segs.filter((s) => mine.has(s) && !ai.has(s));
  const ao = segs.filter((s) => !mine.has(s) && ai.has(s));
  const ov = [both.length ? `같이 고른 문장 ${both.map(segLabel).join(' ')}` : '같이 고른 문장 없음'];
  if (mo.length) ov.push(`나만 ${mo.map(segLabel).join(' ')}`);
  if (ao.length) ov.push(`AI만 ${ao.map(segLabel).join(' ')}`);
  return h('div', { class: 'stack' },
    h('p', { class: 'overlap', text: ov.join(' · ') }),
    h('div', { class: 'ctab' }, segs.map((s) => h('div', { class: 'ctr' },
      h('span', { class: 'lp ghost', text: segLabel(s) }),
      h('span', { class: 's', text: doc.segText(s) }),
      h('div', { class: 'cc2' },
        mine.has(s) ? h('span', { class: 'cc me', text: `나 · ${mine.get(s) || '코드 없음'}` }) : h('span', { class: 'cc none', text: '나 —' }),
        ai.has(s) ? h('span', { class: 'cc ai', text: `AI · ${ai.get(s) || '코드 없음'}` }) : h('span', { class: 'cc none', text: 'AI —' }))))));
}
function viewP2Compare() {
  const r1 = curRun('p1');
  const r2 = curRun('p2');
  const d = r2 ? r2.data : null;
  const sl = srcLines(S.src);
  const ctxMe = sl.length ? h('span', {}, sl.map((t, i) => [i ? h('br') : null, t])) : null;
  const blocks = [
    { id: 'context', no: '①', name: '맥락', q: '실린 매체와 독자까지 짚었나?', body: pair(ctxMe, d && d.context) },
    { id: 'coding', no: '②', name: '코딩', q: '코드가 내 연구 질문에 닿았나?', note: '같은 문장에 다른 코드를 붙였다면, 그 차이는 어디서 왔을까요? 출처·추가 자료·내 경험?', body: codeCompare(d) },
    { id: 'verify', no: '③', name: '검증', q: '원문에 기대어 말했나? 원문에 없는 말을 지어내지 않았나?', note: 'AI 답 전체를 훑어보세요. 필자의 학교·지역처럼 본문에 없는 말을 사실처럼 썼나요?', body: pair(withCrit(S.p2.crit, str(S.p2.verify)), d && withCrit(d.criterion, d.verify)) },
    { id: 'voice', no: '④', name: '표현', q: '한 문장이 1차보다 구체적이 됐나? 누구의 목소리인가?', body: pair(beforeAfter(str(S.p1.sentence), str(S.p2.sentence)), d && beforeAfter(r1 ? r1.data.sentence : '', d.sentence)) },
  ];
  return h('div', { class: 'stack' },
    stepHead('p2_compare', '틀을 줘도 남는 차이', '네 곳을 나란히 보고, 곳마다 해낸 쪽을 골라요.'),
    r2 ? null : h('p', { class: 'notice', text: 'AI 답이 아직 없어요. 이 단계에서도 AI를 돌릴 수 있어요. 위 단계 띠의 ‘② AI에게’로 가 보세요.' }),
    S.p2ai.length > 1 ? runTabs('p2', S.p2ai) : null,
    blocks.map((b) => h('section', { class: 'card' },
      qhead(b.no, b.name, b.q),
      b.note ? h('p', { class: 'hint', text: b.note }) : null,
      b.body,
      segmented(`c-${b.id}`, S.p2cmp[b.id], (v) => { S.p2cmp[b.id] = v; }, 'p2cmp'))),
    h('section', { class: 'card' },
      field('remain', '그래도 남는 차이, 한 줄', '틀을 줘도 AI에게 맡길 수 없는 것은 무엇인가?', S.p2cmp.remain, upd('p2cmp', (v) => { S.p2cmp.remain = v; }), { max: 300 }),
      h('p', { class: 'hint', text: '토론: AI는 문서에 ‘담긴 것’을 읽었나, 문서가 ‘하는 일’까지 읽었나? (Prior, 2003)' })),
    doneNote(isDone('p2_compare')));
}

// ---------------- 화면: 정리 ----------------
const sCell = (label, text, w) => h('div', { class: `cell ${w}` }, h('small', { text: label }), text ? h('p', { text }) : h('p', { class: 'muted', text: '아직 없음' }));
function classCard() {
  const B = ui.board;
  const card = h('section', { class: 'card', id: 'classCard' }, h('div', { class: 'kicker', text: '반 전체' }));
  if (!B) {
    card.append(h('div', { class: 'wait' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), '모인 결과를 불러오는 중…'));
    return card;
  }
  card.append(
    h('h3', { text: `${B.counts.participants}명이 같은 칼럼을 읽었어요` }),
    h('div', { class: 'bgrid' },
      h('div', {},
        h('h4', { text: `실습 1 · ${U()}마다 고른 비율` }),
        keys([['', '사람'], ['ai', 'AI']]),
        lineChart(B, doc)),
      h('div', {},
        h('h4', { text: '해낸 쪽' }),
        keys(CHECK_BOARD.map(([v, l]) => [v, l])),
        checkChart(B, [...DIM_P1, ...DIM_P2]))),
    h('div', { class: 'stack' }, h('h4', { text: '재실습 · 다시 코딩' }), codeTallies(B), topSegs(B, doc)),
    h('div', { class: 'stack' }, h('h4', { text: '그래도 남는 차이' }), itemList(B.p2.remains)));
  return card;
}
const codesLine = (codes) => arr(codes).filter((c) => c && typeof c.seg === 'string').map((c) => `${segLabel(c.seg)} ${str(c.code) || '—'}`).join(' · ');
function report() {
  const L = [];
  const pills = (a) => (a && a.length ? a.map(circ).join('') : '—');
  L.push(`[문서분석 실습 · ${new Date().toLocaleString('ko-KR')}] ${me.name}`);
  L.push(`자료: ${cfg.sourceFull} · 칼럼 ${scopeWord(cfg)} · ${doc.count}${U()} · 문장 ${doc.sents}개`);
  L.push('', '■ 실습 1 (틀 없이)');
  L.push(`나 · 고른 ${U()} ${pills(S.p1.lines)}${str(S.p1.why) ? ` (까닭: ${str(S.p1.why)})` : ''}`);
  L.push(`나 · 한 문장: ${str(S.p1.sentence) || '—'}`);
  S.p1ai.forEach((r, i) => {
    L.push(`AI ${i + 1}회차 (${r.model || 'AI'} · ${fmtTime(r.at)} · ${secs(r.ms)}초) · 고른 ${U()} ${pills(arr(r.data.lines))} · 까닭: ${r.data.why || '—'}`);
    L.push(`  한 문장: ${r.data.sentence || '—'}`);
  });
  L.push(`비교 · 누가·왜까지 읽은 쪽: ${checkLabel(S.p1cmp.who)} · 달랐던 점: ${str(S.p1cmp.word) || '—'}`);
  L.push('', '■ 재실습 (틀을 들고)');
  L.push(`연구 질문: ${rq()}`);
  L.push(`출처·자료 · ${srcLines(S.src).join(' · ') || '—'}`);
  L.push(`나 · 다시 코딩: ${codesLine(S.p2.codes) || '—'}`);
  L.push(`나 · 확인할 것: [${S.p2.crit || '—'}] ${str(S.p2.verify) || '—'}`);
  L.push(`나 · 한 문장: ${str(S.p2.sentence) || '—'}`);
  S.p2ai.forEach((r, i) => {
    const d = r.data;
    L.push(`AI ${i + 1}회차${r.withSrc ? ' · 출처·자료 함께' : ''} (${r.model || 'AI'} · ${fmtTime(r.at)} · ${secs(r.ms)}초)`);
    L.push(`  ① ${d.context || '—'}`);
    L.push(`  ② 다시 코딩: ${codesLine(d.codes) || '—'}`);
    L.push(`  ③ [${d.criterion || '—'}] ${d.verify || '—'}`);
    L.push(`  ④ ${d.sentence || '—'}`);
  });
  L.push(`비교 · 맥락: ${checkLabel(S.p2cmp.context)} · 코딩: ${checkLabel(S.p2cmp.coding)} · 검증: ${checkLabel(S.p2cmp.verify)} · 표현: ${checkLabel(S.p2cmp.voice)}`);
  L.push(`그래도 남는 차이: ${str(S.p2cmp.remain) || '—'}`);
  return L.join('\n');
}
function copyReport() {
  const text = report();
  const fail = () => {
    ui.reportOpen = true;
    renderTask();
    const ta = $('#reportText');
    if (ta) { ta.focus(); ta.select(); }
    toast('복사가 막혔어요. 펼친 글을 직접 복사해 주세요.', true);
  };
  try {
    navigator.clipboard.writeText(text).then(() => toast('복사했어요. 메모장이나 메신저에 붙여 두세요.'), fail);
  } catch { fail(); }
}
function reportCard() {
  const ta = h('textarea', { id: 'reportText', rows: 9, readonly: true });
  ta.value = report();
  return h('section', { class: 'card' },
    h('h3', { text: '내 기록 가져가기' }),
    h('p', { class: 'hint', text: '내 답과 AI 답(모델 · 시각 포함)을 글 하나로 모아요.' }),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn dark', id: 'copyReport', onclick: copyReport, text: '내 기록 복사' })),
    h('details', { class: 'prompt', open: ui.reportOpen ? true : null, ontoggle: (e) => { ui.reportOpen = e.currentTarget.open; } },
      h('summary', { text: '복사될 글 보기' }), ta));
}
function viewSummary() {
  const r1 = curRun('p1');
  const r2 = curRun('p2');
  return h('div', { class: 'stack' },
    stepHead('summary', 'AI와 연구자, 어디서 갈리나', '내 문장 넷을 나란히 보고, 반 전체가 모인 결과와 견주어 봐요.'),
    h('section', { class: 'card' },
      h('h3', { text: '한 문장은 어떻게 달라졌나' }),
      h('div', { class: 'grid4' },
        sCell('나 · 1차', str(S.p1.sentence), 'me'), sCell('나 · 재실습', str(S.p2.sentence), 'me'),
        sCell('AI · 1차', r1 ? r1.data.sentence : '', 'ai'), sCell('AI · 재실습', r2 ? r2.data.sentence : '', 'ai'))),
    classCard(),
    reportCard());
}

// ---------------- 그리기 ----------------
const VIEWS = {
  lobby: viewLobby, p1_human: viewP1Human, p1_ai: viewP1AI, p1_compare: viewP1Compare, explain: viewExplain,
  p2_source: viewP2Source, p2_human: viewP2Human, p2_ai: viewP2AI, p2_compare: viewP2Compare, summary: viewSummary,
};
function viewBoot() {
  if (ui.boot === 'fail') {
    return h('section', { class: 'card notice' },
      h('p', { text: `서버에 연결하지 못했어요. ${ui.bootErr || ''}` }),
      h('p', { class: 'hint', text: '몇 초 뒤 저절로 다시 시도해요.' }));
  }
  return h('div', { class: 'loading' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), '불러오는 중…');
}
function renderLayout() {
  const solo = !cfg || !me.joined || ui.editName || ui.view === 'lobby';
  $('#layout').classList.toggle('solo', solo);
  $('#doc').hidden = solo;
}
function renderTask() {
  const a = document.activeElement;
  const id = a && a.id;
  const span = a && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  let view;
  if (!cfg) view = viewBoot();
  else if (!me.joined || ui.editName) view = viewJoin();
  else view = (VIEWS[ui.view] || viewLobby)();
  $('#task').replaceChildren(view);
  if (id) {
    const e = document.getElementById(id);
    if (e && e !== document.body) {
      e.focus({ preventScroll: true });
      if (span && typeof e.setSelectionRange === 'function') { try { e.setSelectionRange(span[0], span[1]); } catch { /* 고를 수 없는 칸 */ } }
    }
  }
}
function render() {
  renderLayout();
  renderSteps();
  renderBack();
  renderDoc();
  renderTask();
  paintHeader();
}

// ---------------- 시작 ----------------
async function firstLoad() {
  try {
    const t0 = Date.now();
    const st = await api.get('/api/state');
    offset = st.now - (t0 + Date.now()) / 2;
    cfg = st;
    doc = makeDoc(st.raw);
    lastEpoch = st.epoch;
    ui.view = st.phase;
    ui.docOpen = !narrow() || HUMAN_VIEWS.includes(st.phase);
    if (me.name) await reloadMe();
    ui.boot = 'ok';
  } catch (e) {
    ui.boot = 'fail';
    ui.bootErr = e.message;
    cfg = null;
    render();
    setTimeout(firstLoad, 4000);
    return;
  }
  render();
  if (me.joined && ui.view === 'summary') loadBoard();
  schedulePoll();
}

me.id = getId();
me.name = str(store.get('dal-name', ''));
render();
setInterval(paintClock, 1000);
window.addEventListener('resize', () => { document.documentElement.style.setProperty('--topH', `${$('#top').offsetHeight}px`); });
firstLoad();
