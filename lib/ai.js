// Claude API 호출. ANTHROPIC_API_KEY가 없으면 '테스트 모드'로 가짜 답을 돌려준다(리허설용).
import Anthropic from '@anthropic-ai/sdk';
import { promptParts, parseSeg, segSort, toNum } from '../public/assets/text.js';
import { CRITS } from './util.js';

export const MODEL = process.env.MODEL || 'claude-sonnet-5-5';
export const aiMode = process.env.ANTHROPIC_API_KEY ? 'live' : 'mock';
// Vercel 함수는 60초에 끊긴다. 한 번 50초까지 기다리고, 붐빔(429)·일시 오류는 두 번까지 다시 시도.
const client = aiMode === 'live' ? new Anthropic({ maxRetries: 2, timeout: 50_000 }) : null;

function tools(stage, unit) {
  if (stage === 'p1') {
    return {
      name: 'record_reading',
      description: '문서를 읽고 고른 번호와 한 문장을 기록한다. 모든 값은 한국어로 쓴다.',
      input_schema: {
        type: 'object',
        properties: {
          lines: { type: 'array', items: { type: 'integer' }, description: `가장 중요한 ${unit} 번호 1~2개` },
          why: { type: 'string', description: `그 ${unit}을 고른 까닭, 1~2문장` },
          sentence: { type: 'string', description: '이 문서가 무엇을 보여 주는지, 한 문장' },
        },
        required: ['lines', 'why', 'sentence'],
      },
    };
  }
  return {
    name: 'record_framed_reading',
    description: '틀을 들고 다시 읽은 결과를 기록한다. 모든 값은 한국어로 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        context: { type: 'string', description: '① 누가·누구에게·왜·언제 쓴 문서인가, 실린 매체와 독자까지 (2~3문장)' },
        codes: {
          type: 'array',
          description: `② 다시 코딩: 연구 질문에 비추어 의미 있는 문장 3~5개`,
          items: {
            type: 'object',
            properties: {
              seg: { type: 'string', description: `[${unit}-문장] 번호, 예: 4-2` },
              code: { type: 'string', description: '그 문장이 무엇의 증거인지, 짧은 코드' },
            },
            required: ['seg', 'code'],
          },
        },
        criterion: { type: 'string', enum: CRITS, description: '③ 먼저 확인할 Scott의 준거 하나' },
        verify: { type: 'string', description: '③ 무엇을 어떻게 확인할지 (1~2문장)' },
        sentence: { type: 'string', description: '④ 이 문서가 보여 주는 것, 한 문장' },
      },
      required: ['context', 'codes', 'criterion', 'verify', 'sentence'],
    },
  };
}

const s = (v) => String(v ?? '').trim();

export function normalize(stage, d, doc) {
  d = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  if (stage === 'p1') {
    const lines = [...new Set((Array.isArray(d.lines) ? d.lines : [d.lines]).map(toNum)
      .filter((k) => Number.isInteger(k) && k >= 1 && k <= doc.count))].sort((a, b) => a - b).slice(0, 3);
    return { lines, why: s(d.why), sentence: s(d.sentence) };
  }
  const seen = new Set();
  const codes = (Array.isArray(d.codes) ? d.codes : [])
    .map((c) => (c && typeof c === 'object' ? { seg: parseSeg(c.seg, doc), code: s(c.code) } : null))
    .filter((c) => c && c.seg && c.code && !seen.has(c.seg) && seen.add(c.seg))
    .sort((a, b) => segSort(a.seg, b.seg))
    .slice(0, 8);
  return {
    context: s(d.context), codes, criterion: CRITS.includes(s(d.criterion)) ? s(d.criterion) : '',
    verify: s(d.verify), sentence: s(d.sentence),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mock(stage, doc, runNo) {
  const tag = `[테스트 모드 · ${runNo}회차]`;
  const nums = doc.lines.filter((l) => l.n);
  if (stage === 'p1') {
    const pick = runNo % 2 ? [1, doc.count] : [Math.max(1, Math.ceil(doc.count / 2))];
    return {
      lines: [...new Set(pick)].filter((k) => k >= 1),
      why: `${tag} API 키를 넣기 전이라 실제 AI 답 대신 이 문장이 보여요. 실제 수업에서는 AI가 고른 까닭이 여기에 나와요.`,
      sentence: `${tag} 이 칼럼은 온라인 개학을 맞은 교사의 당혹감과 기다림을 보여 준다.`,
    };
  }
  const picks = [nums[0], nums[Math.floor(nums.length / 2)], nums[nums.length - 1]].filter(Boolean);
  const words = ['처음 겪는 당혹감', '흔들리는 교단', '좋은 교사로 남고 싶은 마음'];
  return {
    context: `${tag} 누가·누구에게·왜·언제에 대한 AI의 답이 여기에 나와요.`,
    codes: picks.map((l, i) => ({ seg: `${l.n}-${Math.min(runNo, l.sents.length)}`, code: words[i] })),
    criterion: '대표성',
    verify: `${tag} 확인할 점이 여기에 나와요.`,
    sentence: `${tag} 이 칼럼은 교사가 아이들을 기다리며 자기 역할을 다시 묻는 순간을 보여 준다.`,
  };
}

// stage: 'p1' | 'p2'. src가 있으면 학생이 찾은 출처·추가 자료를 함께 준다.
// 기록하는 prompt는 실제로 보낸 두 덩어리(본문 · 과제)를 빈 줄로 이은 것이다.
export async function analyze(stage, cfg, doc, rq, src, runNo) {
  const { head, tail } = promptParts(stage, cfg, doc, rq, src);
  const prompt = `${head}\n\n${tail}`;
  const at = Date.now();
  if (!client) {
    await sleep(700);
    return { data: normalize(stage, mock(stage, doc, runNo), doc), model: `${MODEL} (테스트 모드)`, usage: {}, prompt, at, ms: Date.now() - at };
  }
  const tool = tools(stage, doc.unit);
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: stage === 'p1' ? 1500 : 2500,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `${head}\n\n`, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: tail },
      ],
    }],
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
  });
  const block = msg.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('AI가 형식에 맞는 답을 주지 않았어요. 다시 눌러 주세요.');
  const data = normalize(stage, block.input, doc);
  if (!data.sentence) throw new Error('AI 답이 비어 있어요. 다시 눌러 주세요.');
  const u = msg.usage || {};
  return {
    data,
    model: msg.model,
    usage: {
      input: u.input_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      output: u.output_tokens || 0,
    },
    prompt,
    at,
    ms: Date.now() - at,
  };
}
