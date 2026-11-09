// 발표자 화면: 단계 넘기기, 참여자와 각자의 답 보기, 본문 올리기, 설정, 내려받기·초기화
import {
  PHASES, PHASE_LABEL, PHASE_MIN, CHECK, api, h, fill, fmtTime, fmtMin, remaining, clockText, toast, makeQR,
} from './common.js';
import { makeDoc, circ, segLabel, srcLines } from './text.js';
import { progressBar } from './charts.js';

const $ = (s) => document.querySelector(s);
const str = (v) => String(v ?? '').trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const checkLabel = (v) => (CHECK.find((c) => c[0] === v) || [null, '—'])[1];
const ss = {
  get: (k) => { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* 저장 못 함 */ } },
};

let code = ss.get('dal-admin');
let D = null; // 마지막 stats 응답
let offset = 0;
let net = true;
let busy = false;
let draft = null;
let draftDirty = false;
let resetArmed = false;
let resetT = null;
let pollT = null;
const openIds = new Set();
let docCache = { raw: null, doc: makeDoc('') };
const curDoc = () => {
  const raw = D?.config?.raw || '';
  if (docCache.raw !== raw) docCache = { raw, doc: makeDoc(raw) };
  return docCache.doc;
};

const admin = (action, extra = {}) => api.post('/api/admin', { code, action, ...extra });

// ---------------- 단계마다 발표자 메모 ----------------
const CUES = {
  lobby: ['보드(/board)를 프로젝터에 띄우면 큰 QR이 나와요.', '다 들어오면 ‘다음’을 눌러 실습 1을 시작해요. 학생 화면과 보드는 3초 안에 같이 넘어가요.'],
  p1_human: ['틀 없이 읽기: 중요한 문단 1~2개에 밑줄, 그리고 한 문장.', '보드에는 다 쓴 사람 수만 올라가요. 답은 아직 안 보여요.'],
  p1_ai: ['학생이 ‘AI에게 맡기기’를 누르면 20초 안팎에 답이 와요.', '보드에 AI가 받는 질문이 떠요. ‘사람과 같은 과제’라는 점을 짚어요.'],
  p1_compare: ['보드: 문단마다 사람/AI 막대, ‘누가·왜’ 체크, 한 단어.', '한 단어 몇 개를 읽어 주고 설명으로 넘어가요.'],
  explain: ['슬라이드로 설명해요 (다섯 질문 · 세 문서 · Scott · 볼 곳).', '보드는 실습 1 결과를 그대로 보여 줘요. 학생 화면엔 틀 카드가 남아요.'],
  p2_source: [`${fmtMin(PHASE_MIN.p2_source)}. 누가·누구에게·왜·언제를 휴대폰으로 찾아 적어요.`, '아래 정답지는 학생 화면에 없어요.'],
  p2_human: ['연구 질문 한 줄 → 문장을 눌러 코드 3개 이상 → 확인할 것 → 한 문장.', '보드에는 코드를 붙인 사람 수가 올라가요.'],
  p2_ai: ['같은 틀로 AI에게. 출처·자료를 적은 사람은 ‘같이 줘 보기’도 눌러 보게 해요.', '보드에 AI가 받는 질문이 떠요.'],
  p2_compare: ['보드: 네 곳 체크 막대, 사람 코드와 AI 코드, 많이 고른 문장.', '‘같은 문장, 다른 코드’ 하나를 골라 이야기해요.'],
  summary: ['보드 ‘정리’: 해낸 쪽 전체와 남는 차이 목록.', 'Prior(2003): 담긴 것과 하는 일. 이어서 김정아 선생님 차례.'],
};
const ANSWER_KEY = [
  ['필자', '장현재. 경남 해양초 교사예요. 교직 30년은 본문 ①에도 나오지만, 학교와 지역은 본문에 없어요.'],
  ['매체', '한국교육신문. 한국교원단체총연합회(교총)가 펴내는 교육 신문이라 독자 대부분이 교사예요. 학생에게 건네는 말투여도 실제로 읽는 사람은 동료 교사예요.'],
  ['그날', '2020년 5월 20일. 코로나19로 미뤄진 등교 개학이 고3부터 시작된 날(80일 만의 첫 등교)이에요. 같은 날 같은 신문에 등교 개학을 다룬 칼럼이 한 편 더 실렸어요.'],
  ['쓴 때', '본문은 ‘39주년 스승의 날’(5월 15일) 장면을 그려요. 쓴 때와 실린 때가 닷새쯤 벌어져서, ‘언제’를 두 겹으로 물을 수 있어요.'],
  ['추가 자료 예', '같은 날 실린 등교 개학 칼럼(맥락), 온라인 개학을 정한 교육부 발표(배경), 본문 ⑤의 ‘교사 자존감’ 같은 주장을 확인할 교원 인식 조사(신빙성).'],
  ['수업에서', '본문만으로는 다 알 수 없는 것들이에요. 사람은 찾아 나서고, AI는 받은 글 안에서 추정해요.'],
];
const FLAGS = [
  ['p1', '실습 1 · ① 읽기'], ['p1ai', '실습 1 · ② AI'], ['p1cmp', '실습 1 · ③ 비교'],
  ['src', '재실습 · ⓪ 출처'], ['p2codes', '재실습 · ① 코드'], ['p2', '재실습 · ① 한 문장'], ['p2ai', '재실습 · ② AI'], ['p2cmp', '재실습 · ③ 비교'],
];
const dl = (rows) => h('dl', { class: 'crit-list' }, rows.map(([a, b]) => [h('dt', { text: a }), h('dd', { text: b })]));
const pill = (text, cls = '') => h('span', { class: `pill ${cls}`, text });

// ---------------- 머리 ----------------
function paintHeader() {
  const cfg = D?.config;
  $('#phaseBadge').textContent = cfg ? PHASE_LABEL[cfg.phase] : '…';
  const left = cfg ? remaining(cfg, offset) : null;
  const c = $('#clock');
  c.textContent = clockText(left);
  c.classList.toggle('over', left != null && left <= 0);
  const rc = $('#runClock');
  if (rc && cfg) rc.textContent = left == null ? '' : left <= 0 ? ' · 시간 끝' : ` · 남은 ${clockText(left)}`;
}
function paintWho() {
  const who = $('#who');
  if (!D) { fill(who); return; }
  fill(who,
    net ? null : h('span', { class: 'sv bad', text: '연결 끊김 · ' }),
    h('button', { type: 'button', onclick: () => logout(), text: '나가기' }));
}
// 4초마다 새로 받지만, 바뀐 칸만 다시 그린다 (누르려던 버튼이 사라지지 않게)
const lastKeys = {};
function changed(k, v) {
  const s = JSON.stringify(v);
  if (lastKeys[k] === s) return false;
  lastKeys[k] = s;
  return true;
}
let keyOpen = false;

// ---------------- 상태 · 진행 ----------------
function renderStatus() {
  const u = D.usage;
  $('#status').replaceChildren(
    pill(D.aiMode === 'live' ? `AI 연결됨 · ${D.model}` : 'AI 테스트 모드 · API 키 없음', D.aiMode === 'live' ? 'good' : 'bad'),
    pill(D.store === 'redis' ? '저장소 연결됨' : '임시 메모리 · Vercel에선 Upstash 연결 필요', D.store === 'redis' ? 'good' : 'bad'),
    pill(D.config.aiEnabled ? 'AI 버튼 켜짐' : 'AI 버튼 꺼짐', D.config.aiEnabled ? '' : 'bad'),
    pill(`참여 ${D.counts.participants}명`),
    pill(`AI ${u.calls} / ${D.maxCalls}회 · 약 $${(u.costUSD || 0).toFixed(2)}`));
}
async function setPhase(p) {
  if (busy) return;
  busy = true;
  renderRun();
  try {
    const t0 = Date.now();
    const r = await admin('phase', { phase: p });
    offset = r.now - (t0 + Date.now()) / 2;
    D.config = r.config;
    toast(`‘${PHASE_LABEL[p]}’로 넘겼어요`);
  } catch (e) {
    toast(e.message, true);
  } finally {
    busy = false;
    renderRun();
    renderStatus();
    paintHeader();
  }
}
function renderRun() {
  const cfg = D.config;
  const i = PHASES.indexOf(cfg.phase);
  const prev = PHASES[i - 1];
  const next = PHASES[i + 1];
  fill($('#runCard'),
    h('div', { class: 'kicker', text: '진행' }),
    h('h2', {}, PHASE_LABEL[cfg.phase],
      h('span', { class: 'muted small', text: cfg.phaseAt ? ` · ${fmtTime(cfg.phaseAt)} 시작` : '' }),
      h('span', { class: 'muted small', id: 'runClock' })),
    h('div', { class: 'bigrow' },
      prev ? h('button', { type: 'button', class: 'btn ghost', disabled: busy, onclick: () => setPhase(prev), text: '← 이전' }) : null,
      next ? h('button', { type: 'button', class: 'btn', id: 'nextBtn', disabled: busy, onclick: () => setPhase(next), text: `다음: ${PHASE_LABEL[next]} →` }) : null),
    h('div', { class: 'cue' },
      h('b', { text: '지금 할 일 ' }),
      CUES[cfg.phase].join(' '),
      cfg.phase === 'p2_source' ? h('div', { style: { marginTop: '8px' } }, dl(ANSWER_KEY)) : null),
    h('div', { class: 'phases' }, PHASES.map((id) => h('button', {
      type: 'button', class: cfg.phase === id ? 'on' : '', disabled: busy, onclick: () => setPhase(id),
    }, PHASE_LABEL[id], h('small', { text: PHASE_MIN[id] ? fmtMin(PHASE_MIN[id]) : '입장 받기' })))),
    cfg.phase === 'p2_source' ? null : h('details', {
      class: 'prompt', open: keyOpen ? true : null, ontoggle: (e) => { keyOpen = e.currentTarget.open; },
    }, h('summary', { text: '출처 정답지 (재실습 ⓪에서 써요)' }), dl(ANSWER_KEY)));
  paintHeader();
}

// ---------------- 참여자 ----------------
function answers(p) {
  const U = curDoc().unit;
  const pills = (a) => (a && a.length ? a.map(circ).join(' ') : '—');
  const last = (runs) => runs[runs.length - 1];
  const a1 = last(p.p1ai);
  const a2 = last(p.p2ai);
  const codes = (list) => arr(list).map((c) => `${segLabel(c.seg)} ${str(c.code) || '—'}`).join(' · ') || '—';
  const box = (cls, label, ...lines) => h('div', { class: `box ${cls}` }, h('small', { text: label }), lines.filter(Boolean).map((t) => h('p', { text: t })));
  const sl = srcLines(p.src);
  return h('div', { class: 'ans grid2' },
    box('', '실습 1 · 나', `고른 ${U} ${pills(p.p1?.lines)}${str(p.p1?.why) ? ` — ${str(p.p1.why)}` : ''}`, `한 문장: ${str(p.p1?.sentence) || '—'}`),
    box('ai', `실습 1 · AI${p.p1ai.length > 1 ? ` (${p.p1ai.length}회 중 마지막)` : ''}`,
      a1 ? `고른 ${U} ${pills(a1.data?.lines)}` : '아직 안 돌림', a1 ? `한 문장: ${a1.data?.sentence || '—'}` : null),
    box('', '실습 1 · 비교', `누가·왜까지 읽은 쪽: ${checkLabel(p.p1cmp?.who)}`, `한 단어: ${str(p.p1cmp?.word) || '—'}`),
    box('', '재실습 · 출처·자료', ...(sl.length ? sl : ['—'])),
    box('', '재실습 · 나', `연구 질문: ${str(p.p2?.rq) || '(예시 질문)'}`, `코드: ${codes(p.p2?.codes)}`,
      `확인할 것: [${p.p2?.crit || '—'}] ${str(p.p2?.verify) || '—'}`, `한 문장: ${str(p.p2?.sentence) || '—'}`),
    box('ai', `재실습 · AI${p.p2ai.length > 1 ? ` (${p.p2ai.length}회 중 마지막)` : ''}${a2?.withSrc ? ' · 출처 함께' : ''}`,
      a2 ? `코드: ${codes(a2.data?.codes)}` : '아직 안 돌림',
      a2 ? `확인할 것: [${a2.data?.criterion || '—'}] ${a2.data?.verify || '—'}` : null,
      a2 ? `한 문장: ${a2.data?.sentence || '—'}` : null),
    box('', '재실습 · 비교',
      `맥락 ${checkLabel(p.p2cmp?.context)} · 코딩 ${checkLabel(p.p2cmp?.coding)} · 검증 ${checkLabel(p.p2cmp?.verify)} · 표현 ${checkLabel(p.p2cmp?.voice)}`,
      `남는 차이: ${str(p.p2cmp?.remain) || '—'}`));
}
function personRow(p) {
  const done = FLAGS.filter(([k]) => p.progress[k]).length;
  return h('details', {
    class: 'person', open: openIds.has(p.id) ? true : null,
    ontoggle: (e) => { if (e.currentTarget.open) openIds.add(p.id); else openIds.delete(p.id); },
  },
  h('summary', {},
    p.name || '이름 없음',
    h('span', { class: 'dots', role: 'img', 'aria-label': `${FLAGS.length}칸 가운데 ${done}칸 함` },
      FLAGS.map(([k, l]) => h('i', { class: p.progress[k] ? 'on' : '', title: l }))),
    h('span', { text: `${fmtTime(p.joinedAt)} 입장 · AI ${p.p1ai.length + p.p2ai.length}회` })),
  answers(p));
}
function renderPeople() {
  const N = D.counts.participants;
  $('#peopleCard').replaceChildren(
    h('div', { class: 'kicker', text: '참여자' }),
    h('h2', { text: `참여자 ${N}명` }),
    h('p', { class: 'hint', text: '학생 화면(/)에 이름을 적고 들어온 사람이 여기에 떠요. 발표자도 휴대폰이나 다른 탭으로 들어가면 같이 떠요. 이름을 누르면 그 사람의 답이 펼쳐져요. 4초마다 새로 고쳐져요.' }),
    h('div', { class: 'progress-grid' }, FLAGS.map(([k, l]) => progressBar(l, D.counts[k] || 0, N))),
    N ? h('div', { class: 'stack' },
      h('div', { class: 'row small muted' }, '칸 순서: ', FLAGS.map(([, l]) => l.replace(/^.*· /, '')).join(' · ')),
      D.people.map(personRow)) : h('p', { class: 'muted', text: '아직 아무도 없어요.' }));
}

// ---------------- 본문 ----------------
const pickDraft = (c) => ({
  raw: c.raw || '', sourceFull: c.sourceFull || '', sourceShort: c.sourceShort || '', defaultRQ: c.defaultRQ || '', scope: c.scope === 'part' ? 'part' : 'full',
});
const sameDraft = (a, b) => ['raw', 'sourceFull', 'sourceShort', 'defaultRQ', 'scope'].every((k) => a[k] === b[k]);
function markDirty() {
  draftDirty = !sameDraft(draft, pickDraft(D.config));
  paintDocState();
}
function paintDocState() {
  const d = makeDoc(draft.raw);
  $('#docCount').textContent = draft.raw.trim()
    ? `${d.count}${d.unit} · 문장 ${d.sents}개${d.heads ? ` · 소제목 ${d.heads}개` : ''} · ${draft.raw.replace(/\s/g, '').length}자`
    : '아직 비어 있어요';
  $('#pv').replaceChildren(...d.lines.map((l) => (l.gap ? h('li', { class: 'pv-gap', text: '(…)' })
    : l.head ? h('li', { class: 'pv-hd', text: l.text })
      : h('li', {}, h('span', { class: 'pv-n', text: circ(l.n) }), h('span', {}, `${l.text} `, h('span', { class: 'muted', text: `(문장 ${l.sents.length})` }))))));
  $('#docState').textContent = draftDirty ? '저장 안 한 변경이 있어요' : (D.config.raw ? `저장됨 · ${fmtTime(D.config.updatedAt)}` : '');
  $('#docWarn').hidden = !(draftDirty && D.config.phase !== 'lobby' && draft.raw !== D.config.raw);
  document.querySelectorAll('#scopeChips button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === draft.scope)));
}
function textField(id, label, hint, key, max) {
  const inp = h('input', { type: 'text', id, maxlength: max, autocomplete: 'off' });
  inp.value = draft[key];
  inp.addEventListener('input', () => { draft[key] = inp.value; markDirty(); });
  return h('label', { class: 'field', for: id }, h('span', { class: 'label', text: label }), hint ? h('span', { class: 'hint', text: hint }) : null, inp);
}
function renderDocCard() {
  const ta = h('textarea', { id: 'raw', rows: 12, placeholder: '여기에 칼럼 본문을 붙여 넣으세요' });
  ta.value = draft.raw;
  ta.addEventListener('input', () => { draft.raw = ta.value; markDirty(); });
  const scopeBtn = (v, label) => h('button', {
    type: 'button', class: 'mini', 'data-v': v, 'aria-pressed': String(draft.scope === v),
    onclick: () => { draft.scope = v; markDirty(); }, text: label,
  });
  $('#docCard').replaceChildren(
    h('div', { class: 'kicker', text: '본문' }),
    h('h2', { text: '칼럼 올리기' }),
    h('p', { class: 'hint', text: '칼럼을 붙여 넣으세요. 줄바꿈마다 번호가 붙어서, 문단째 붙이면 문단마다 번호가 붙어요. 재실습에서는 문단 안을 문장으로 다시 끊어 [문단-문장] 번호로 코딩해요. 짧고 마침표 없는 줄(소제목)은 번호 없이 제목으로 보이고, 건너뛴 곳은 (…)만 한 줄에 적어요.' }),
    h('label', { class: 'field', for: 'raw' }, h('span', { class: 'label', text: '본문' }), ta),
    h('p', { class: 'hint', id: 'docCount' }),
    h('details', { class: 'prompt' }, h('summary', { text: '번호 붙은 모양 미리 보기' }), h('ol', { class: 'pv', id: 'pv' })),
    h('div', { class: 'field' },
      h('span', { class: 'label', text: '범위' }),
      h('div', { class: 'row', id: 'scopeChips' }, scopeBtn('full', '칼럼 전문'), scopeBtn('part', '칼럼 일부')),
      h('span', { class: 'hint', text: 'AI 질문의 “칼럼 전문이다 / 일부이다”에 들어가요.' })),
    textField('sourceFull', '화면에 보일 출처', '학생 화면의 문서 위와 보드에 보여요.', 'sourceFull', 200),
    textField('sourceShort', 'AI에게 주는 출처', 'AI 질문의 “다음은 ○○에 실린 한 교사의 칼럼…”에서 ○○ 자리예요. 필자 이름은 빼 두는 게 기본이에요.', 'sourceShort', 80),
    textField('defaultRQ', '예시 연구 질문', '재실습에서 학생이 비워 두면 이 질문으로 해요.', 'defaultRQ', 300),
    h('p', { class: 'warn', id: 'docWarn', hidden: true, text: '수업 중이에요. 본문을 바꾸면 학생들이 고른 번호가 어긋날 수 있어요.' }),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', id: 'saveDoc', onclick: saveDoc, text: '본문 저장' }),
      h('span', { class: 'hint', id: 'docState' })));
  paintDocState();
}
async function saveDoc() {
  if (makeDoc(draft.raw).count < 2) { toast('본문을 두 단위 이상 넣어 주세요.', true); return; }
  const b = $('#saveDoc');
  b.disabled = true;
  try {
    const r = await admin('config', { patch: { ...draft } });
    D.config = r.config;
    draftDirty = false;
    paintDocState();
    toast('본문을 저장했어요. 학생 화면과 보드에 3초 안에 나타나요.');
  } catch (e) {
    toast(e.message, true);
  } finally {
    b.disabled = false;
  }
}

// ---------------- 설정 ----------------
async function patch(p) {
  try {
    const r = await admin('config', { patch: p });
    D.config = r.config;
    renderSettings();
    renderStatus();
    toast('바꿨어요.');
  } catch (e) {
    toast(e.message, true);
  }
}
function renderSettings() {
  const c = D.config;
  const toggle = (on, a, b, set) => h('div', { class: 'row' },
    h('button', { type: 'button', class: 'mini', 'aria-pressed': String(!!on), onclick: () => { if (!on) set(true); }, text: a }),
    h('button', { type: 'button', class: 'mini', 'aria-pressed': String(!on), onclick: () => { if (on) set(false); }, text: b }));
  const row = (label, ctrl, hint) => h('div', { class: 'field' }, h('span', { class: 'label', text: label }), ctrl, hint ? h('span', { class: 'hint', text: hint }) : null);
  $('#setCard').replaceChildren(
    h('div', { class: 'kicker', text: '설정' }),
    h('h2', { text: 'AI와 보드' }),
    row('AI 버튼', toggle(c.aiEnabled, '켜짐', '꺼짐', (v) => patch({ aiEnabled: v })), 'AI는 ‘AI에게’와 ‘비교’ 단계에서만 돌아가요. 끄면 학생 화면의 AI 버튼이 잠겨요.'),
    row('학생 1명이 단계마다 AI를 돌릴 수 있는 횟수',
      h('div', { class: 'row' }, [1, 2, 3].map((v) => h('button', {
        type: 'button', class: 'mini', 'aria-pressed': String(c.maxRuns === v), onclick: () => { if (c.maxRuns !== v) patch({ maxRuns: v }); }, text: `${v}번`,
      }))),
      '2번이면 ‘같은 질문, 다른 답’을 볼 수 있고, 재실습에선 ‘출처·자료도 같이’까지 해 볼 수 있어요.'),
    row('보드에 이름 보이기', toggle(c.showNames, '보임', '안 보임', (v) => patch({ showNames: v })), '끄면 보드에는 답만 모이고, 이름은 이 화면에서만 보여요.'));
}

// ---------------- 링크 · 기록 ----------------
function renderLinks() {
  const base = location.origin;
  const qr = h('div', { class: 'qr' });
  makeQR(qr, `${base}/`, 168);
  $('#linkCard').replaceChildren(
    h('div', { class: 'kicker', text: '링크' }),
    h('h2', { text: '학생 · 보드 · 나도 참여' }),
    h('div', { class: 'qrbox' }, qr,
      h('div', { class: 'linklist' },
        h('div', {}, h('b', { text: '학생 ' }), h('code', { text: `${base}/` })),
        h('div', {}, h('b', { text: '보드 ' }), h('a', { href: '/board', target: '_blank', rel: 'noopener', text: `${base}/board` }), h('span', { class: 'hint', text: ' · 프로젝터에 띄워요' })),
        h('div', {}, h('b', { text: '나도 참여 ' }), h('a', { href: '/', target: '_blank', rel: 'noopener', text: '학생 화면 새 탭으로 열기' }), h('span', { class: 'hint', text: ' · 이름을 적으면 참여자 목록에 같이 떠요' })))),
    h('p', { class: 'hint', text: 'QR은 슬라이드에 넣을 수 있어요. QR 위에서 마우스 오른쪽 버튼 → 이미지 저장.' }));
}
const stamp = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};
function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function exportAll() {
  try {
    const r = await admin('export');
    download(`doc-analysis-lab-${stamp()}.json`, JSON.stringify(r, null, 2), 'application/json');
  } catch (e) {
    toast(e.message, true);
  }
}
function exportCSV() {
  const last = (runs) => runs[runs.length - 1];
  const codes = (list) => arr(list).map((c) => `${segLabel(c.seg)} ${str(c.code)}`).join(' / ');
  const cols = ['이름', '입장', '실습1 고른 번호', '실습1 까닭', '실습1 한 문장', 'AI1 고른 번호', 'AI1 한 문장', 'AI1 횟수', '누가·왜', '한 단어',
    '출처·자료', '연구 질문', '재실습 코드', '확인 준거', '확인할 것', '재실습 한 문장', 'AI2 코드', 'AI2 준거', 'AI2 한 문장', 'AI2 출처 함께', 'AI2 횟수',
    '맥락', '코딩', '검증', '표현', '남는 차이'];
  const rows = D.people.map((p) => {
    const a1 = last(p.p1ai);
    const a2 = last(p.p2ai);
    return [p.name, fmtTime(p.joinedAt), arr(p.p1?.lines).join(' '), p.p1?.why, p.p1?.sentence, arr(a1?.data?.lines).join(' '), a1?.data?.sentence, p.p1ai.length,
      checkLabel(p.p1cmp?.who), p.p1cmp?.word, srcLines(p.src).join(' / '), p.p2?.rq, codes(p.p2?.codes), p.p2?.crit, p.p2?.verify, p.p2?.sentence,
      codes(a2?.data?.codes), a2?.data?.criterion, a2?.data?.sentence, a2 ? (a2.withSrc ? '예' : '아니오') : '', p.p2ai.length,
      checkLabel(p.p2cmp?.context), checkLabel(p.p2cmp?.coding), checkLabel(p.p2cmp?.verify), checkLabel(p.p2cmp?.voice), p.p2cmp?.remain];
  });
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  download(`doc-analysis-lab-${stamp()}.csv`, `﻿${[cols, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}`, 'text/csv');
}
async function resetAll() {
  if (!resetArmed) {
    resetArmed = true;
    renderData();
    clearTimeout(resetT);
    resetT = setTimeout(() => { resetArmed = false; renderData(); }, 4000);
    return;
  }
  resetArmed = false;
  clearTimeout(resetT);
  try {
    await admin('reset');
    openIds.clear();
    toast('참여자와 답을 모두 지웠어요. 단계는 ‘대기’로 돌아갔어요.');
    await refresh();
  } catch (e) {
    toast(e.message, true);
  }
  renderData();
}
function renderData() {
  $('#dataCard').replaceChildren(
    h('div', { class: 'kicker', text: '기록' }),
    h('h2', { text: '내려받기 · 모두 지우기' }),
    h('p', { class: 'hint', text: '전체 내려받기(JSON)에는 본문 · 설정 · 학생 답 · AI 답(모델 · 시각 · 보낸 질문)이 모두 들어가요. 사람별 답(CSV)은 엑셀에서 바로 열려요.' }),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn dark', onclick: exportAll, text: '전체 내려받기 (JSON)' }),
      h('button', { type: 'button', class: 'btn ghost', onclick: exportCSV, disabled: !D?.people?.length, text: '사람별 답 (CSV)' }),
      h('button', { type: 'button', class: `btn ghost${resetArmed ? ' armed' : ''}`, id: 'resetBtn', onclick: resetAll, text: resetArmed ? '한 번 더 누르면 모두 지워져요' : '모두 지우기' })),
    h('p', { class: 'hint', text: '리허설을 마치고 수업 직전에 한 번 지우세요. 본문과 설정은 남고, 참여자 · 답 · AI 사용량이 지워져요. 학생 화면은 저절로 처음으로 돌아가요.' }));
}

// ---------------- 불러오기 ----------------
async function refresh() {
  try {
    const t0 = Date.now();
    const r = await admin('stats');
    offset = r.now - (t0 + Date.now()) / 2;
    D = r;
    net = true;
    if (!draft || (!draftDirty && !sameDraft(draft, pickDraft(D.config)))) {
      draft = pickDraft(D.config);
      renderDocCard();
    } else {
      paintDocState();
    }
    if (changed('status', [D.aiMode, D.model, D.store, D.config.aiEnabled, D.counts.participants, D.usage.calls, D.usage.costUSD])) renderStatus();
    if (changed('run', [D.config.phase, D.config.phaseAt])) renderRun();
    if (changed('people', [D.counts, D.people])) renderPeople();
    if (changed('set', [D.config.aiEnabled, D.config.maxRuns, D.config.showNames])) renderSettings();
    if (changed('data', [D.people.length])) renderData();
  } catch (e) {
    if (e.status === 401) { logout(true); return; }
    net = false;
  }
  paintHeader();
  paintWho();
}
function schedule() {
  clearTimeout(pollT);
  pollT = setTimeout(async () => { await refresh(); if (code) schedule(); }, document.hidden ? 15000 : 4000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && D && code) { refresh(); schedule(); } });

function showLogin(msg) {
  $('#panel').hidden = true;
  $('#login').hidden = false;
  const e = $('#loginErr');
  e.textContent = msg || '';
  e.hidden = !msg;
  $('#code').focus();
}
function logout(expired) {
  clearTimeout(pollT);
  code = '';
  ss.set('dal-admin', '');
  D = null;
  Object.keys(lastKeys).forEach((k) => { delete lastKeys[k]; });
  paintHeader();
  paintWho();
  showLogin(expired === true ? '발표자 코드가 바뀌었거나 맞지 않아요. 다시 입력해 주세요.' : '');
}
async function login(c) {
  code = c;
  const btn = $('#loginBtn');
  btn.disabled = true;
  try {
    await admin('check');
    ss.set('dal-admin', code);
    $('#login').hidden = true;
    $('#panel').hidden = false;
    renderLinks();
    await refresh();
    schedule();
  } catch (e) {
    code = '';
    ss.set('dal-admin', '');
    showLogin(e.message);
  } finally {
    btn.disabled = false;
  }
}

$('#loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#code').value.trim();
  if (v) login(v);
});
setInterval(paintHeader, 1000);
if (code) login(code); else showLogin();
