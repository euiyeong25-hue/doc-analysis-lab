// 프로젝터 보드: 발표자가 넘기는 단계에 맞춰, 진행 상황과 반 전체 결과를 크게 보여 준다.
import {
  PHASE_LABEL, PHASE_MIN, CHECK_BOARD, api, h, fmtMin, remaining, clockText, makeQR, flowBar,
} from './common.js';
import {
  makeDoc, circ, scopeWord, P1_HEAD, P1_TASK, P2_HEAD, P2_TASK, fillPrompt,
} from './text.js';
import {
  lineChart, checkChart, codeTallies, topSegs, wordChips, itemList, keys, progressBar, DIM_P1, DIM_P2,
} from './charts.js';

const $ = (s) => document.querySelector(s);
const url = `${location.origin}/`;
const TABS = [['auto', '지금 단계'], ['p1', '실습 1 결과'], ['p2', '재실습 결과'], ['sum', '정리']];

let B = null;
let doc = makeDoc('');
let offset = 0;
let tab = 'auto';
let lastKey = '';
let lastPhase = null;
const bigQR = h('div', { class: 'qr' });
let bigQRMade = false;

const head = (title, lead) => h('div', { class: 'b-title' }, h('h1', { text: title }), lead ? h('p', { text: lead }) : null);
const n = (text) => h('span', { class: 'n', text });
const bigClock = () => h('div', { class: 'big-clock', 'aria-live': 'off' });

// ---------------- 단계별 화면 ----------------
function lobbyView() {
  if (!bigQRMade) { makeQR(bigQR, url, 300); bigQRMade = true; }
  const N = B.counts.participants;
  return h('section', { class: 'lobby' },
    bigQR,
    h('div', {},
      h('h1', { text: '휴대폰으로 들어와 주세요' }),
      h('p', { class: 'url', text: url.replace(/^https?:\/\//, '').replace(/\/$/, '') }),
      h('p', { class: 'big', text: N ? `지금 ${N}명 들어왔어요` : '이름(별명)만 적으면 들어와요. 로그인은 필요 없어요.' }),
      flowBar()));
}
function waitView(title, lead, bars, side) {
  const N = B.counts.participants;
  return h('div', { class: 'stack' },
    head(title, lead),
    h('div', { class: 'b-grid' },
      h('section', { class: 'panel' },
        h('h3', { text: '진행' }),
        bars.map(([label, k]) => progressBar(label, k, N)),
        bigClock()),
      side));
}
function docPanel() {
  return h('section', { class: 'panel' },
    h('h3', { text: '오늘 읽는 문서' }),
    h('p', { class: 'b-src', text: B.cfg.sourceFull }),
    h('ul', { class: 'b-tips' },
      h('li', { text: `칼럼 ${scopeWord(B.cfg)} · 번호가 붙은 ${doc.count}${doc.unit}` }),
      h('li', { text: `휴대폰에선 화면 위, 넓은 화면에선 왼쪽에 문서가 있어요. ${doc.unit}을 누르면 밑줄이 그어져요.` }),
      h('li', { text: '아직 AI도, 틀도 없어요. 평소 하던 대로 읽어요.' })));
}
function promptPanel(kind) {
  const c = B.cfg;
  const body = `${circ(1)} … ${circ(doc.count)}  ← 번호 붙은 본문 ${doc.count}${doc.unit}${kind === 'p2' ? ` · 문장마다 [${doc.unit}-문장] 번호` : ''}`;
  const v = { source: c.sourceShort || '한 신문', rq: '각자 적은 연구 질문', unit: doc.unit, scope: scopeWord(c), numbered: body, sentenced: body };
  const text = `${fillPrompt(kind === 'p1' ? P1_HEAD : P2_HEAD, v)}\n\n${fillPrompt(kind === 'p1' ? P1_TASK : P2_TASK, v)}`;
  return h('section', { class: 'panel ai' },
    h('h3', { text: 'AI가 받는 질문' }),
    h('pre', { class: 'b-prompt', text }),
    h('p', { class: 'b-src', text: kind === 'p1'
      ? '검색은 못 해요. 사람과 같은 과제예요.'
      : '검색은 못 해요. 학생이 찾은 출처·자료는 ‘같이 줘 보기’를 누를 때만 받아요.' }));
}
function extrasPanel() {
  const list = B.src.extras.map((x) => ({ text: [x.name, x.note].filter(Boolean).join(' — '), name: x.who }));
  return h('section', { class: 'panel' },
    h('h3', {}, '모인 추가 자료', n(`${list.length}개`)),
    itemList(list, '아직 없어요. 찾은 자료가 여기에 모여요.'));
}
function framePanel() {
  return h('section', { class: 'panel' },
    h('h3', { text: '들고 가는 틀' }),
    h('ul', { class: 'b-tips' },
      h('li', {}, h('b', { text: '다섯 질문 · ' }), '누가 · 누구에게 · 왜 · 언제는 출처·자료에서, 무엇의 증거로는 코드로'),
      h('li', {}, h('b', { text: 'Scott · ' }), '진정성 · 신빙성 · 대표성 · 의미'),
      h('li', {}, h('b', { text: '연구 질문 예 · ' }), B.cfg.defaultRQ)));
}
function p1Result(title = '실습 1 · 나와 AI, 무엇이 같고 달랐나') {
  const p1 = B.p1;
  return h('div', { class: 'stack' },
    head(title, `${doc.unit}마다 사람이 고른 비율과 AI가 고른 비율, 그리고 ‘누가·왜’까지 읽은 쪽`),
    h('div', { class: 'b-grid' },
      h('section', { class: 'panel' },
        h('h3', {}, `${doc.unit}마다 고른 비율`, n(`사람 ${p1.pickers}명 · AI ${p1.aiRuns}회`)),
        keys([['', '사람'], ['ai', 'AI']]),
        lineChart(B, doc)),
      h('section', { class: 'panel' },
        h('h3', { text: '‘누가·왜 썼나’까지 읽은 쪽' }),
        keys(CHECK_BOARD),
        checkChart(B, DIM_P1),
        h('h3', {}, '무엇이 달랐나, 한 단어', n(`${p1.words.reduce((a, w) => a + w.count, 0)}개`)),
        wordChips(p1.words))),
    h('div', { class: 'b-grid' },
      h('section', { class: 'panel' }, h('h3', {}, '사람의 한 문장', n(`${p1.human.length}개`)), itemList(p1.human)),
      h('section', { class: 'panel ai' }, h('h3', {}, 'AI의 한 문장', n(`${p1.ai.length}회`)), itemList(p1.ai))));
}
function p2Result(title = '재실습 · 틀을 줘도 남는 차이') {
  const p2 = B.p2;
  return h('div', { class: 'stack' },
    head(title, '네 곳마다 해낸 쪽, 그리고 같은 문장에 붙은 사람 코드와 AI 코드'),
    h('div', { class: 'b-grid' },
      h('section', { class: 'panel' }, h('h3', { text: '네 곳, 해낸 쪽' }), keys(CHECK_BOARD), checkChart(B, DIM_P2)),
      h('section', { class: 'panel' },
        h('h3', {}, '다시 코딩', n(`사람 ${p2.coders}명 · AI ${p2.aiRuns}회`)),
        codeTallies(B),
        topSegs(B, doc))),
    h('div', { class: 'b-grid' },
      h('section', { class: 'panel' }, h('h3', {}, '사람의 한 문장, 다시', n(`${p2.human.length}개`)), itemList(p2.human)),
      h('section', { class: 'panel ai' }, h('h3', {}, '틀을 받은 AI의 한 문장', n(`${p2.ai.length}회`)), itemList(p2.ai))),
    h('section', { class: 'panel' }, h('h3', {}, '그래도 남는 차이', n(`${p2.remains.length}개`)), itemList(p2.remains)));
}
function sumView() {
  return h('div', { class: 'stack' },
    head('AI와 연구자, 어디서 갈리나', 'AI는 문서에 ‘담긴 것’을 읽고, 연구자는 문서가 ‘하는 일’까지 읽는다 (Prior, 2003)'),
    h('div', { class: 'b-grid' },
      h('section', { class: 'panel' }, h('h3', { text: '해낸 쪽, 실습 1부터 재실습까지' }), keys(CHECK_BOARD), checkChart(B, [...DIM_P1, ...DIM_P2])),
      h('section', { class: 'panel' }, h('h3', {}, '그래도 남는 차이', n(`${B.p2.remains.length}개`)), itemList(B.p2.remains))),
    h('div', { class: 'b-grid' },
      h('section', { class: 'panel' }, h('h3', { text: '실습 1 · 무엇이 달랐나, 한 단어' }), wordChips(B.p1.words)),
      h('section', { class: 'panel' }, h('h3', { text: '재실습 · 사람 코드와 AI 코드' }), codeTallies(B))));
}
function byPhase(p) {
  const U = doc.unit;
  switch (p) {
    case 'lobby': return lobbyView();
    case 'p1_human':
      return waitView('실습 1 · ① 혼자 읽기', `틀 없이 읽어요. 가장 중요한 ${U} 1~2개에 밑줄을 긋고, 이 문서가 무엇을 보여 주는지 한 문장으로 써요.`,
        [['밑줄 긋고 한 문장까지 쓴 사람', B.counts.p1]], docPanel());
    case 'p1_ai':
      return waitView('실습 1 · ② AI에게', '같은 본문을 틀 없이 AI에게 줘요. 과제는 사람과 똑같아요.',
        [['AI를 돌린 사람', B.counts.p1ai]], promptPanel('p1'));
    case 'p1_compare': return p1Result('실습 1 · ③ 나와 AI, 무엇이 같고 달랐나');
    case 'explain': return p1Result('설명 · 이 단어들에서 시작해요');
    case 'p2_source':
      return waitView(`재실습 · ⓪ 출처·자료 ${fmtMin(PHASE_MIN.p2_source)}`, '누가 · 누구에게 · 왜 · 언제를 찾고, 해석을 도울 추가 자료를 남겨요. AI는 이 단계를 하지 않아요.',
        [['출처·자료를 적은 사람', B.counts.src]], extrasPanel());
    case 'p2_human':
      return waitView('재실습 · ① 다시 코딩', `내 연구 질문을 들고, ${U} 안을 문장 단위로 다시 읽어요. 문장마다 ‘무엇의 증거인가’를 코드로 붙여요.`,
        [['코드를 붙인 사람', B.counts.p2codes], ['한 문장까지 다시 쓴 사람', B.counts.p2]], framePanel());
    case 'p2_ai':
      return waitView('재실습 · ② AI에게', '같은 틀을 AI에게도 줘요. AI는 문장을 몇 개나, 어떤 코드로 묶을까요?',
        [['AI를 돌린 사람', B.counts.p2ai]], promptPanel('p2'));
    case 'p2_compare': return p2Result('재실습 · ③ 틀을 줘도 남는 차이');
    case 'summary': return sumView();
    default: return head(PHASE_LABEL[p] || '');
  }
}

// ---------------- 그리기 ----------------
function renderTabs(show) {
  const box = $('#tabs');
  box.hidden = !show;
  if (!show) return;
  box.replaceChildren(...TABS.map(([k, label]) => h('button', {
    type: 'button', class: tab === k ? 'on' : '', 'aria-pressed': String(tab === k),
    onclick: () => { tab = k; render(); }, text: label,
  })));
}
function paintClock() {
  if (!B) return;
  const left = remaining(B.cfg, offset);
  const t = clockText(left);
  const over = left != null && left <= 0;
  const c = $('#clock');
  c.textContent = t;
  c.classList.toggle('over', over);
  document.querySelectorAll('.big-clock').forEach((e) => { e.textContent = t; e.classList.toggle('over', over); });
}
function render() {
  const phase = B.cfg.phase;
  $('#phaseBadge').textContent = PHASE_LABEL[phase] || '…';
  $('#count').textContent = `${B.counts.participants}명 참여`;
  renderTabs(phase !== 'lobby');
  $('#corner').hidden = phase === 'lobby' && tab === 'auto';
  const view = tab === 'p1' ? p1Result() : tab === 'p2' ? p2Result() : tab === 'sum' ? sumView() : byPhase(phase);
  $('#main').replaceChildren(view);
  paintClock();
}

async function poll() {
  try {
    const t0 = Date.now();
    const b = await api.get('/api/board');
    offset = b.now - (t0 + Date.now()) / 2;
    if (b.cfg.phase !== lastPhase) { tab = 'auto'; lastPhase = b.cfg.phase; }
    const key = JSON.stringify({ ...b, now: 0 });
    if (key !== lastKey) {
      lastKey = key;
      B = b;
      if (doc.raw !== b.cfg.raw) doc = makeDoc(b.cfg.raw);
      render();
    }
    $('#count').classList.remove('bad');
  } catch {
    $('#count').textContent = '연결 확인 중…';
  }
  setTimeout(poll, document.hidden ? 15000 : 3000);
}

makeQR($('#qrSmall'), url, 110);
setInterval(paintClock, 1000);
poll();
