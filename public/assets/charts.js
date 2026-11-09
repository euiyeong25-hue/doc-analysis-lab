// 반 전체 결과 그리기 (보드 · 학생 '정리' · 발표자 화면 공용). 입력은 /api/board 의 summarize 결과.
import { h, CHECK_BOARD } from './common.js';
import { circ, segLabel } from './text.js';

const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);

export const keys = (list) => h('div', { class: 'keys' }, list.map(([cls, label]) => h('span', { class: `k ${cls}`, text: label })));

// 실습 1: 단위(문단·줄)마다 사람이 고른 비율과 AI가 고른 비율
export function lineChart(sum, doc) {
  if (!doc.count) return h('p', { class: 'muted', text: '본문이 아직 없어요.' });
  const N = sum.p1.pickers || 0;
  const R = sum.p1.aiRuns || 0;
  return h('div', { class: 'chart' }, Array.from({ length: doc.count }, (_, i) => {
    const k = i + 1;
    const pc = sum.p1.picks[k] || 0;
    const ac = sum.p1.aiPicks[k] || 0;
    return h('div', { class: 'crow', title: doc.textOf(k) },
      h('span', { class: 'cl', text: circ(k) }),
      h('div', { class: 'ctrack' },
        h('div', { class: 'cbar', title: '사람' }, h('i', { style: { width: `${pct(pc, N)}%` } })),
        h('div', { class: 'cbar ai', title: 'AI' }, h('i', { style: { width: `${pct(ac, R)}%` } }))),
      h('span', { class: 'cval', text: `사람 ${pc}/${N} · AI ${R ? `${ac}/${R}회` : '–'}` }));
  }));
}

export const DIM_P1 = [['실습 1 · 누가·왜', (s) => s.p1.who]];
export const DIM_P2 = [
  ['① 맥락', (s) => s.p2.checks.context],
  ['② 코딩', (s) => s.p2.checks.coding],
  ['③ 검증', (s) => s.p2.checks.verify],
  ['④ 표현', (s) => s.p2.checks.voice],
];

// '해낸 쪽' 체크를 한 줄에 쌓는다. 칸 안 숫자는 고른 사람 수.
export function checkChart(sum, dims) {
  return h('div', { class: 'chart' }, dims.map(([label, get]) => {
    const c = get(sum) || {};
    const total = CHECK_BOARD.reduce((a, [v]) => a + (c[v] || 0), 0);
    return h('div', { class: 'srow' },
      h('span', { text: label }),
      h('div', { class: 'stackbar', role: 'img', 'aria-label': `${label}: ${CHECK_BOARD.map(([v, l]) => `${l} ${c[v] || 0}`).join(', ')}` },
        total ? CHECK_BOARD.filter(([v]) => c[v]).map(([v, l]) => h('i', { class: v, title: `${l} ${c[v]}`, style: { width: `${(c[v] / total) * 100}%` }, text: String(c[v]) })) : null),
      h('span', { class: 'cval', text: total ? `${total}명` : '아직' }));
  }));
}

export function wordChips(list, cls = '', empty = '아직 없어요.') {
  if (!list || !list.length) return h('span', { class: 'muted small', text: empty });
  return h('div', { class: 'wchips' }, list.map((w) => h('span', { class: `wchip ${cls}` }, w.text, w.count > 1 ? h('span', { class: 'c', text: `×${w.count}` }) : null)));
}

export function codeTallies(sum, max = 14) {
  return h('div', { class: 'stack' },
    h('div', { class: 'tally' }, h('b', { text: '사람' }), wordChips(sum.p2.humanCodes.slice(0, max))),
    h('div', { class: 'tally' }, h('b', { text: 'AI' }), wordChips(sum.p2.aiCodes.slice(0, max), 'ai')));
}

export function topSegs(sum, doc) {
  const list = sum.p2.segs.filter((x) => doc.validSeg(x.seg));
  if (!list.length) return null;
  return h('ul', { class: 'topsegs' }, list.map((x) => h('li', {},
    h('span', { class: 'lp ghost', text: segLabel(x.seg) }),
    h('span', { class: 's', text: doc.segText(x.seg) }),
    h('span', { class: 'cval', text: `사람 ${x.h} · AI ${x.a}` }))));
}

// [{text, name}] → 목록. 이름은 발표자가 '보드에 이름 보이기'를 켰을 때만 온다.
export function itemList(list, empty = '아직 없어요.') {
  if (!list || !list.length) return h('p', { class: 'empty-note', text: empty });
  return h('ul', { class: 'items' }, list.map((x) => h('li', {}, x.text, x.name ? h('span', { class: 'tag', text: x.name }) : null)));
}

export function progressBar(label, n, N) {
  return h('div', { class: 'progress' },
    h('div', { class: 'lab' }, h('span', { text: label }), h('b', { text: `${n} / ${N}` })),
    h('div', { class: 'bar', role: 'img', 'aria-label': `${label} ${n}명 / ${N}명` }, h('i', { style: { width: `${pct(n, N)}%` } })));
}
