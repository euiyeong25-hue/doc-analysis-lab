import { api, PHASE_LABEL, el, makeQR } from './common.js';

const $ = (s) => document.querySelector(s);
const joinUrl = `${location.origin}/`;
let manualTab = null;
let lastPhase = null;

makeQR($('#qrBig'), joinUrl, 260);
makeQR($('#qrSmall'), joinUrl, 96);
$('#url').textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

function list(id, items, empty) {
  const ol = $(`#${id}`);
  ol.replaceChildren();
  if (!items.length) { ol.append(el('li', { class: 'empty-note', text: empty })); return; }
  items.forEach((it) => ol.append(el('li', {}, it.text,
    it.run > 1 ? el('span', { class: 'tag', text: `${it.run}회차` }) : null,
    it.name ? el('span', { class: 'tag', text: `— ${it.name}` }) : null)));
}

function showTab(tab) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#tab-p1').hidden = tab !== 'p1';
  $('#tab-p2').hidden = tab !== 'p2';
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { manualTab = b.dataset.tab; showTab(manualTab); }));

async function tick() {
  try {
    const d = await api.get('/api/board');
    const phase = d.phase;
    if (phase !== lastPhase) { manualTab = null; lastPhase = phase; }
    $('#phase').textContent = PHASE_LABEL[phase] || phase;
    $('#count').textContent = `참여 ${d.counts.participants}명`;
    $('#lobbyCount').textContent = `지금 ${d.counts.participants}명 입장`;

    const lobby = phase === 'lobby';
    $('#lobby').hidden = !lobby;
    $('#main').hidden = lobby;
    $('#corner').hidden = lobby;

    const auto = ['p2_human', 'p2_ai', 'p2_compare', 'summary'].includes(phase) ? 'p2' : 'p1';
    showTab(manualTab || auto);

    list('p1h', d.p1.human, '아직 없어요');
    list('p1a', d.p1.ai, '아직 없어요');
    $('#n-p1h').textContent = d.p1.human.length;
    $('#n-p1a').textContent = d.p1.ai.length;
    const chips = $('#chips');
    chips.replaceChildren();
    if (!d.p1.diffs.length) chips.append(el('span', { class: 'empty-note', text: '비교가 끝나면 여기에 모여요' }));
    const max = Math.max(1, ...d.p1.diffs.map((x) => x.count));
    d.p1.diffs.forEach((x) => chips.append(el('span', {
      class: 'chip', style: `font-size:${(1 + (x.count / max) * 0.9).toFixed(2)}em`,
    }, x.word, x.count > 1 ? el('span', { class: 'c', text: `×${x.count}` }) : null)));

    list('p2h', d.p2.human, '아직 없어요');
    list('p2a', d.p2.ai, '아직 없어요');
    $('#n-p2h').textContent = d.p2.human.length;
    $('#n-p2a').textContent = d.p2.ai.length;
    ['context', 'purpose', 'verify', 'expression'].forEach((k) => list(`r-${k}`, d.p2.remain[k], '—'));
  } catch { /* 다음 주기에 다시 */ }
}

tick();
setInterval(tick, 3000);
