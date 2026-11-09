import { api, PHASE_LABEL, el, fmtTime, store, toast, previewPrompt } from './common.js';

const $ = (s) => document.querySelector(s);
const S = { id: store.get('lab.id', null), name: store.get('lab.name', ''), cfg: null, me: {}, sig: '', busy: {} };

if (!S.id) {
  const raw = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  S.id = raw.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  store.set('lab.id', S.id);
}

/* ---------- small builders ---------- */
const card = (...kids) => el('section', { class: 'card' }, ...kids);
const kicker = (t) => el('div', { class: 'kicker', text: t });
const h2 = (t) => el('h2', { text: t });
const muted = (t) => el('p', { class: 'muted', text: t });
const row = (...kids) => el('div', { class: 'row' }, ...kids);
const field = (label, control, hint) => el('label', { class: 'field' },
  el('span', { class: 'label', text: label }), hint ? el('span', { class: 'hint', text: hint }) : null, control);
const quote = (label, text, cls = '') => el('div', { class: `quote ${cls}` }, el('small', { text: label }), text || '');
const blk = (label, text) => el('div', { class: 'blk' }, el('b', { text: label }), el('span', { text: text || '' }));
const box = (label, text, cls = '') => el('div', { class: `box ${cls} ${text ? '' : 'empty'}` },
  el('small', { text: label }), text || '아직 없어요');
const doneLine = (sec) => (sec?.at ? el('span', { class: 'done', text: `저장됨 · ${fmtTime(sec.at)}` }) : null);

function draft(key, saved, { lines = 3, placeholder = '' } = {}) {
  const k = `lab.draft.${S.id}.${key}`;
  const node = lines > 1 ? el('textarea', { rows: lines, placeholder }) : el('input', { type: 'text', placeholder });
  node.value = store.get(k, null) ?? saved ?? '';
  node.addEventListener('input', () => store.set(k, node.value));
  return node;
}

/* ---------- actions ---------- */
async function submit(section, data, btn) {
  btn.disabled = true;
  try {
    const r = await api.post('/api/submit', { id: S.id, section, data });
    S.me[section] = r.data;
    toast('저장했어요');
  } catch (e) {
    toast(e.message, true);
  }
  render();
}

async function runAI(stage) {
  if (S.busy[stage]) return;
  S.busy[stage] = true;
  render();
  try {
    const r = await api.post('/api/analyze', { id: S.id, stage });
    S.me[`${stage}ai`] = r.runs;
  } catch (e) {
    toast(e.message, true);
  }
  S.busy[stage] = false;
  render();
}

/* ---------- views ---------- */
const myRQ = () => S.me.p2?.rq || S.cfg.defaultRQ;

function p1Form(late) {
  const read = draft('p1.read', S.me.p1?.read, { lines: 4, placeholder: '눈에 띈 내용과 표현' });
  const sentence = draft('p1.sentence', S.me.p1?.sentence, { lines: 2, placeholder: '이 칼럼은 ________을 보여 준다.' });
  const btn = el('button', { class: 'btn', text: S.me.p1 ? '다시 저장' : '제출' });
  btn.onclick = () => submit('p1', { read: read.value, sentence: sentence.value }, btn);
  return card(
    kicker(late ? '실습 1 · 아직 안 냈다면 먼저' : '실습 1 · ① 사람 — 4분, 혼자'),
    h2('틀 없이, 먼저 읽어 보기'),
    muted('평소 하던 대로 읽고 두 가지를 적어 주세요.'),
    field('① 이 문서에서 무엇을 읽었나?', read),
    field('② 이 문서는 무엇을 보여 주나? — 한 문장', sentence),
    row(btn, doneLine(S.me.p1)),
  );
}

function p2Form(late) {
  const rq = draft('p2.rq', S.me.p2?.rq, { lines: 1, placeholder: S.cfg.defaultRQ });
  const ctx = draft('p2.context', S.me.p2?.context, { lines: 3 });
  const pur = draft('p2.purpose', S.me.p2?.purpose, { lines: 3 });
  const ver = draft('p2.verify', S.me.p2?.verify, { lines: 2 });
  const sen = draft('p2.sentence', S.me.p2?.sentence, { lines: 2, placeholder: '이 칼럼은 ________을 보여 준다.' });
  const btn = el('button', { class: 'btn', text: S.me.p2 ? '다시 저장' : '제출' });
  btn.onclick = () => submit('p2', {
    rq: rq.value.trim() || S.cfg.defaultRQ, context: ctx.value, purpose: pur.value, verify: ver.value, sentence: sen.value,
  }, btn);
  return card(
    kicker(late ? '재실습 · 아직 안 냈다면 먼저' : '재실습 · ① 사람 — 4분 30초, 혼자'),
    h2('같은 칼럼, 다섯 질문으로'),
    field('먼저, 내 연구 질문 한 줄', rq, '비워 두면 예시 질문으로 갑니다'),
    field('① 누가·누구에게·왜·언제 썼나?', ctx, '실린 매체와 독자까지'),
    field('② 무엇의 증거로 쓸까?', pur, '내 연구 질문에 비추어'),
    field('③ 믿기 전에 확인할 것', ver, '진정성 · 신빙성 · 대표성 · 의미 중 하나'),
    field('④ 한 문장으로 다시 쓰기', sen, S.me.p1?.sentence ? `1차 때 쓴 문장: ${S.me.p1.sentence}` : '1차 문장과 무엇이 달라졌나'),
    row(btn, doneLine(S.me.p2)),
  );
}

function aiCard(stage, r) {
  const meta = el('div', { class: 'meta', text: `AI 답 · ${r.run}회차 · ${r.model} · ${fmtTime(r.at)}` });
  if (stage === 'p1') {
    return el('article', { class: 'ai' }, meta, el('p', { text: r.analysis }), quote('AI의 한 문장', r.one_sentence, 'ai'));
  }
  return el('article', { class: 'ai' }, meta,
    blk('① 누가·누구에게·왜·언제', r.context),
    blk('② 무엇의 증거로', r.purpose),
    blk('③ 확인할 것', r.verification),
    quote('④ AI의 한 문장', r.one_sentence, 'ai'));
}

function aiPanel(stage) {
  const { cfg } = S;
  const runs = S.me[`${stage}ai`] || [];
  const busy = !!S.busy[stage];
  const label = runs.length ? `한 번 더 돌려 보기 (${runs.length + 1}회차)` : (stage === 'p1' ? 'AI에게 맡기기' : '같은 틀로 AI에게');
  const btn = el('button', { class: runs.length ? 'btn dark' : 'btn', text: label, disabled: !cfg.aiEnabled || runs.length >= cfg.maxRuns || busy });
  btn.onclick = () => runAI(stage);
  let note = null;
  if (!cfg.aiEnabled) note = el('p', { class: 'warn', text: '지금은 AI가 꺼져 있어요.' });
  else if (runs.length >= cfg.maxRuns) note = muted(`이 단계에서는 AI를 ${cfg.maxRuns}번까지 돌릴 수 있어요.`);
  else if (runs.length) note = muted('같은 질문이면 같은 답이 나올까요? 한 번 더 돌려 비교해 보세요.');
  const prompt = runs.at(-1)?.prompt || previewPrompt(stage, cfg, myRQ());
  return card(
    kicker(stage === 'p1' ? '실습 1 · ② AI — 3분 30초' : '재실습 · ② AI — 3분 30초'),
    h2(stage === 'p1' ? 'AI에게 그냥 맡기면?' : '같은 틀을 AI에게도'),
    muted(stage === 'p1' ? '같은 발췌문을 기본 프롬프트로 Claude에게 보냅니다.' : '내 연구 질문을 넣어, 같은 네 질문으로 Claude에게 보냅니다.'),
    stage === 'p2' ? el('p', { class: 'rq' }, el('b', { text: '내 연구 질문 · ' }), myRQ()) : null,
    el('details', { class: 'prompt' }, el('summary', { text: '보낸 프롬프트 보기' }), el('pre', { text: prompt })),
    row(btn, busy ? el('span', { class: 'wait' }, el('span', { class: 'spin' }), 'AI가 읽는 중이에요 (10~30초)') : null),
    note,
    ...runs.map((r) => aiCard(stage, r)),
  );
}

function mySummary(title, pairs) {
  return card(kicker('내 답'), h2(title), ...pairs.map(([l, t]) => quote(l, t)));
}

function p1Compare() {
  const runs = S.me.p1ai || [];
  const ai = runs[0];
  const word = draft('p1diff.word', S.me.p1diff?.word, { lines: 1, placeholder: '한 단어로' });
  const btn = el('button', { class: 'btn', text: S.me.p1diff ? '다시 보내기' : '보내기' });
  btn.onclick = () => submit('p1diff', { word: word.value }, btn);
  return [
    ai ? null : aiPanel('p1'),
    card(
      kicker('실습 1 · ③ 비교 — 짝과 함께'),
      h2('나와 AI, 무엇이 같고 달랐나'),
      el('div', { class: 'cmp' },
        el('div', { class: 'cmp-block' }, el('div', { class: 'cmp-title' }, el('b', { text: '무엇을 읽었나' })),
          el('div', { class: 'cmp-pair' }, box('나', S.me.p1?.read), box('AI', ai?.analysis, 'ai'))),
        el('div', { class: 'cmp-block' }, el('div', { class: 'cmp-title' }, el('b', { text: '한 문장' })),
          el('div', { class: 'cmp-pair' }, box('나', S.me.p1?.sentence), box('AI', ai?.one_sentence, 'ai')),
          runs[1] ? quote('2회차 AI의 한 문장 — 1회차와 같은가?', runs[1].one_sentence, 'ai') : null)),
      field('달랐던 점, 한 단어', word, '짝과 이야기한 뒤 한 단어로 — 보드에 모입니다'),
      row(btn, doneLine(S.me.p1diff)),
    ),
  ];
}

const ROWS = [
  ['context', '① 맥락', '누가·누구에게·왜·언제', 'context', 'context'],
  ['purpose', '② 목적', '무엇의 증거로', 'purpose', 'purpose'],
  ['verify', '③ 검증', '믿기 전에 확인할 것', 'verify', 'verification'],
  ['expression', '④ 표현', '한 문장', 'sentence', 'one_sentence'],
];

function p2Compare() {
  const ai = (S.me.p2ai || [])[0];
  const inputs = {};
  const blocks = ROWS.map(([key, title, sub, mine, theirs]) => {
    inputs[key] = draft(`p2cmp.${key}`, S.me.p2cmp?.[key], { lines: 1, placeholder: '그래도 남는 차이는?' });
    return el('div', { class: 'cmp-block' },
      el('div', { class: 'cmp-title' }, el('b', { text: title }), ' ', el('span', { class: 'muted', text: sub })),
      el('div', { class: 'cmp-pair' }, box('나', S.me.p2?.[mine]), box('AI', ai?.[theirs], 'ai')),
      inputs[key]);
  });
  const btn = el('button', { class: 'btn', text: S.me.p2cmp ? '다시 보내기' : '보내기' });
  btn.onclick = () => submit('p2cmp', Object.fromEntries(Object.entries(inputs).map(([k, n]) => [k, n.value])), btn);
  return [
    ai ? null : aiPanel('p2'),
    card(
      kicker('재실습 · ③ 비교 — 짝 → 전체'),
      h2('틀을 줘도 남는 차이'),
      muted('칸마다 나와 AI를 비교하고, 그래도 남는 차이를 한 줄로 적어 주세요.'),
      el('div', { class: 'cmp' }, ...blocks),
      row(btn, doneLine(S.me.p2cmp)),
    ),
  ];
}

const VIEWS = {
  lobby: () => card(kicker('대기'), h2('곧 시작해요'), muted(`${S.name}님, 입장했어요. 발표자가 시작하면 화면이 저절로 넘어갑니다.`)),
  p1_human: () => p1Form(false),
  p1_ai: () => [S.me.p1 ? mySummary('1차 — 틀 없이 읽은 것', [['무엇을 읽었나', S.me.p1.read], ['한 문장', S.me.p1.sentence]]) : p1Form(true), aiPanel('p1')],
  p1_compare: () => p1Compare(),
  explain: () => card(kicker('설명'), h2('설명 중이에요'), muted('앞 화면을 봐 주세요. 곧 재실습으로 넘어갑니다.'),
    S.me.p1?.sentence ? quote('내 1차 한 문장', S.me.p1.sentence) : null),
  p2_human: () => p2Form(false),
  p2_ai: () => [S.me.p2 ? mySummary('재실습 — 다섯 질문으로 읽은 것', [['내 연구 질문', S.me.p2.rq], ['한 문장', S.me.p2.sentence]]) : p2Form(true), aiPanel('p2')],
  p2_compare: () => p2Compare(),
  summary: () => card(kicker('정리'), h2('AI와 연구자, 어디서 갈리나'), muted('앞 화면을 봐 주세요. 반 전체의 답이 보드에 모여 있어요.'),
    el('a', { class: 'btn ghost', href: '/board', target: '_blank', rel: 'noopener', text: '보드 열기' })),
};

/* ---------- render ---------- */
function render() {
  const { cfg } = S;
  if (!cfg) return;
  $('#phaseBadge').textContent = PHASE_LABEL[cfg.phase] || cfg.phase;
  const who = $('#who');
  who.replaceChildren();
  if (S.name) who.append(S.name, el('button', { type: 'button', text: '바꾸기', onclick: rename }));
  $('#joinCard').hidden = !!S.name;

  const docPhases = ['p1_human', 'p1_ai', 'p1_compare', 'p2_human', 'p2_ai', 'p2_compare'];
  const doc = $('#doc');
  doc.hidden = !(S.name && docPhases.includes(cfg.phase));
  $('#docSource').textContent = cfg.sourceFull || '';
  $('#docText').textContent = cfg.excerpt || '자료가 아직 없어요. 발표자가 곧 올립니다.';

  const box2 = $('#phase');
  box2.replaceChildren();
  if (!S.name) return;
  const view = VIEWS[cfg.phase] || VIEWS.lobby;
  [].concat(view()).filter(Boolean).forEach((n) => box2.append(n));
}

function rename() {
  S.name = '';
  store.set('lab.name', '');
  render();
  $('#joinName').focus();
}

async function refreshState() {
  const cfg = await api.get('/api/state');
  S.cfg = cfg;
  return [cfg.phase, cfg.excerpt, cfg.sourceFull, cfg.aiEnabled, cfg.maxRuns, cfg.defaultRQ].join('|');
}

async function refreshMe() {
  try { S.me = await api.get(`/api/me?id=${encodeURIComponent(S.id)}`); } catch { /* keep */ }
}

async function tick() {
  try {
    const sig = await refreshState();
    if (sig !== S.sig) {
      S.sig = sig;
      await refreshMe();
      render();
    }
  } catch { /* 네트워크가 잠깐 끊겨도 다음 주기에 다시 */ }
}

$('#joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#joinName').value.trim();
  if (!name) return;
  try {
    await api.post('/api/join', { id: S.id, name });
    S.name = name;
    store.set('lab.name', name);
    render();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#docToggle').addEventListener('click', () => {
  const d = $('#doc');
  d.classList.toggle('folded');
  $('#docToggle').textContent = d.classList.contains('folded') ? '펼치기' : '접기';
});

(async () => {
  await tick();
  if (S.name) api.post('/api/join', { id: S.id, name: S.name }).catch(() => {});
  setInterval(tick, 2500);
})();
