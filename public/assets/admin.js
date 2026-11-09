import { api, PHASE_LABEL, el, toast, makeQR } from './common.js';

const $ = (s) => document.querySelector(s);
const PHASES = [
  ['lobby', '입장 받기'], ['p1_human', '4분'], ['p1_ai', '3분 30초'], ['p1_compare', '3분 30초'],
  ['explain', '8분 30초'], ['p2_human', '4분 30초'], ['p2_ai', '3분 30초'], ['p2_compare', '4분 30초'], ['summary', '4분'],
];
let code = sessionStorage.getItem('lab.admin') || '';
let cfg = null;
let resetArmed = false;

const admin = (action, extra = {}) => api.post('/api/admin', { code, action, ...extra });

function paintStatus(info) {
  const s = $('#status');
  s.replaceChildren(
    el('span', { class: `pill ${info.aiMode === 'live' ? 'good' : 'bad'}`, text: info.aiMode === 'live' ? `AI 연결됨 · ${info.model}` : 'AI 테스트 모드 (API 키 없음)' }),
    el('span', { class: `pill ${info.store === 'redis' ? 'good' : 'bad'}`, text: info.store === 'redis' ? '저장소 연결됨 (Redis)' : '저장소: 임시 메모리 — Vercel에선 Upstash 연결 필요' }),
    el('span', { class: 'pill', text: `AI 호출 상한 ${info.maxCalls}회` }),
  );
}

function paintPhases() {
  const box = $('#phases');
  box.replaceChildren(...PHASES.map(([id, t]) => el('button', {
    type: 'button', class: cfg.phase === id ? 'on' : '', onclick: () => setPhase(id),
  }, PHASE_LABEL[id], el('small', { text: t }))));
  $('#phaseBadge').textContent = PHASE_LABEL[cfg.phase];
}

function fillForms() {
  $('#sourceFull').value = cfg.sourceFull || '';
  $('#sourceShort').value = cfg.sourceShort || '';
  $('#excerpt').value = cfg.excerpt || '';
  $('#excerptCount').textContent = `${(cfg.excerpt || '').length}자`;
  $('#aiEnabled').checked = !!cfg.aiEnabled;
  $('#maxRuns').value = String(cfg.maxRuns);
  $('#showNames').checked = !!cfg.showNames;
  $('#defaultRQ').value = cfg.defaultRQ || '';
}

function paintLinks() {
  const student = `${location.origin}/`;
  const board = `${location.origin}/board`;
  const copy = (url) => el('button', { class: 'btn ghost', type: 'button', text: '복사', onclick: () => navigator.clipboard?.writeText(url).then(() => toast('복사했어요')) });
  $('#links').replaceChildren(
    el('div', {}, el('b', { text: '학생 ' }), el('code', { text: student }), ' ', copy(student)),
    el('div', {}, el('b', { text: '보드 ' }), el('code', { text: board }), ' ', copy(board), ' ',
      el('a', { href: '/board', target: '_blank', rel: 'noopener', text: '열기' })),
  );
  makeQR($('#qr'), student, 160);
}

async function setPhase(id) {
  try {
    cfg = (await admin('phase', { phase: id })).config;
    paintPhases();
    toast(`${PHASE_LABEL[id]}(으)로 넘겼어요`);
  } catch (e) { toast(e.message, true); }
}

async function saveConfig(patch, msg) {
  try {
    cfg = (await admin('config', { patch })).config;
    fillForms();
    toast(msg);
  } catch (e) { toast(e.message, true); }
}

async function refreshStats() {
  try {
    const s = await admin('stats');
    const c = s.counts;
    const rows = [
      ['입장', `${c.participants}명`],
      ['실습 1 · 사람 제출', `${c.p1}명`], ['실습 1 · AI 실행', `${c.p1ai}명`], ['실습 1 · 비교 제출', `${c.p1diff}명`],
      ['재실습 · 사람 제출', `${c.p2}명`], ['재실습 · AI 실행', `${c.p2ai}명`], ['재실습 · 비교 제출', `${c.p2cmp}명`],
      ['AI 호출', `${s.usage.calls}회 / 상한 ${s.maxCalls}회`],
      ['토큰', `입력 ${s.usage.input.toLocaleString()} · 출력 ${s.usage.output.toLocaleString()}`],
      ['예상 비용', `약 $${s.usage.costUSD}`],
    ];
    $('#stats').replaceChildren(...rows.map(([a, b]) => el('tr', {}, el('th', { text: a }), el('td', { text: b }))));
  } catch { /* 다음 주기 */ }
}

async function enter() {
  try {
    const info = await admin('check');
    sessionStorage.setItem('lab.admin', code);
    cfg = info.config;
    $('#login').hidden = true;
    $('#panel').hidden = false;
    paintStatus(info);
    paintPhases();
    fillForms();
    paintLinks();
    refreshStats();
    setInterval(refreshStats, 5000);
  } catch (e) {
    sessionStorage.removeItem('lab.admin');
    toast(e.message, true);
  }
}

$('#loginForm').addEventListener('submit', (e) => { e.preventDefault(); code = $('#code').value.trim(); enter(); });
$('#excerpt').addEventListener('input', () => { $('#excerptCount').textContent = `${$('#excerpt').value.length}자`; });
$('#saveDoc').addEventListener('click', () => saveConfig({
  excerpt: $('#excerpt').value, sourceFull: $('#sourceFull').value, sourceShort: $('#sourceShort').value,
}, '자료를 저장했어요'));
$('#saveSettings').addEventListener('click', () => saveConfig({
  aiEnabled: $('#aiEnabled').checked, maxRuns: Number($('#maxRuns').value), showNames: $('#showNames').checked, defaultRQ: $('#defaultRQ').value,
}, '설정을 저장했어요'));

$('#export').addEventListener('click', async () => {
  try {
    const data = await admin('export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `doc-analysis-lab-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json` });
    document.body.append(a);
    a.click();
    a.remove();
  } catch (e) { toast(e.message, true); }
});

$('#reset').addEventListener('click', async () => {
  const b = $('#reset');
  if (!resetArmed) {
    resetArmed = true;
    b.textContent = '정말 지울까요? 한 번 더 누르기';
    b.classList.replace('ghost', 'dark');
    setTimeout(() => { resetArmed = false; b.textContent = '모두 지우기'; b.classList.replace('dark', 'ghost'); }, 4000);
    return;
  }
  resetArmed = false;
  try {
    cfg = (await admin('reset')).config;
    paintPhases();
    refreshStats();
    toast('모두 지웠어요');
  } catch (e) { toast(e.message, true); }
  b.textContent = '모두 지우기';
  b.classList.replace('dark', 'ghost');
});

if (code) enter();
