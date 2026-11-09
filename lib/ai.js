// Claude API 호출. ANTHROPIC_API_KEY가 없으면 '테스트 모드'로 가짜 답을 돌려준다(리허설용).
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.MODEL || 'claude-sonnet-5-5';
export const aiMode = process.env.ANTHROPIC_API_KEY ? 'live' : 'mock';
const client = aiMode === 'live' ? new Anthropic({ maxRetries: 3, timeout: 55_000 }) : null;

export function buildPrompt(stage, cfg, rq) {
  const head = `다음은 ${cfg.sourceShort}에 실린 한 교사의 칼럼 일부다.`;
  if (stage === 'p1') {
    return `${head} 질적연구자로서 이 문서를 분석하고, 이 문서가 무엇을 보여 주는지 한 문장으로 써 줘.\n\n[발췌문]\n${cfg.excerpt}`;
  }
  return `${head} 내 연구 질문은 ‘${rq}’이다.\n`
    + '① 누가·누구에게·왜·언제 썼나 ② 무엇의 증거가 될 수 있나 ③ Scott의 네 준거(진정성·신빙성·대표성·의미)로 무엇을 확인해야 하나 '
    + `④ 이 문서가 보여 주는 것을 한 문장으로 써 줘.\n\n[발췌문]\n${cfg.excerpt}`;
}

const TOOLS = {
  p1: {
    name: 'record_analysis',
    description: '문서분석 결과를 기록한다. 모든 내용은 한국어로 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        analysis: { type: 'string', description: '이 문서에 대한 분석 (5~8문장)' },
        one_sentence: { type: 'string', description: '이 문서가 무엇을 보여 주는지, 한 문장' },
      },
      required: ['analysis', 'one_sentence'],
    },
  },
  p2: {
    name: 'record_framed_analysis',
    description: '네 질문에 대한 문서분석 결과를 기록한다. 모든 내용은 한국어로 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        context: { type: 'string', description: '① 누가·누구에게·왜·언제 썼나 (2~4문장)' },
        purpose: { type: 'string', description: '② 연구 질문에 비추어, 이 문서는 무엇의 증거가 될 수 있나 (2~4문장)' },
        verification: { type: 'string', description: '③ Scott의 네 준거로 무엇을 확인해야 하나 (2~4문장)' },
        one_sentence: { type: 'string', description: '④ 이 문서가 보여 주는 것, 한 문장' },
      },
      required: ['context', 'purpose', 'verification', 'one_sentence'],
    },
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mock(stage, runNo) {
  const tag = `[테스트 모드 · ${runNo}회차]`;
  if (stage === 'p1') {
    return {
      analysis: `${tag} API 키를 넣기 전이라 실제 AI 답 대신 이 문장이 보입니다. 실제 수업에서는 Claude가 발췌문을 분석한 내용이 여기에 나옵니다.`,
      one_sentence: `${tag} 이 칼럼은 온라인 개학을 맞은 교사의 당혹감을 보여 준다.`,
    };
  }
  return {
    context: `${tag} 누가·누구에게·왜·언제에 대한 AI의 답이 여기에 나옵니다.`,
    purpose: `${tag} 연구 질문에 비춘 '무엇의 증거로'가 여기에 나옵니다.`,
    verification: `${tag} Scott의 준거로 확인할 점이 여기에 나옵니다.`,
    one_sentence: `${tag} 이 칼럼은 교사가 자기 역할을 다시 묻는 순간을 보여 준다.`,
  };
}

export async function analyze(stage, cfg, rq, runNo) {
  const prompt = buildPrompt(stage, cfg, rq);
  const at = Date.now();
  if (!client) {
    await sleep(600);
    return { data: mock(stage, runNo), model: `${MODEL} (테스트 모드)`, usage: { input: 0, output: 0 }, prompt, at };
  }
  const tool = TOOLS[stage];
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: stage === 'p1' ? 1500 : 2000,
    messages: [{ role: 'user', content: prompt }],
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
  });
  const block = msg.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('AI가 형식에 맞는 답을 주지 않았어요. 다시 눌러 주세요.');
  return {
    data: block.input,
    model: msg.model,
    usage: { input: msg.usage?.input_tokens || 0, output: msg.usage?.output_tokens || 0 },
    prompt,
    at,
  };
}
