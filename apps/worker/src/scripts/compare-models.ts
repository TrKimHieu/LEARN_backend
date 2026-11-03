/**
 * So sánh model LLM trên đúng pipeline sinh bài học (chunk → outline → lesson → validate 4 tầng),
 * bỏ phần DB/queue. Dùng để chọn LLM_MODEL_GENERATION bằng số liệu thay vì phỏng đoán — ADR 009.
 *
 *   cd apps/worker
 *   npx tsx src/scripts/compare-models.ts <tài liệu.md> <thư mục kết quả> <model> [model...]
 *
 * Gọi API thật theo LLM_PROVIDER/LLM_API_KEY trong apps/worker/.env — TỐN TIỀN nếu không ở free
 * tier. Không bật model dự phòng: mục đích là đo chính model được chỉ định.
 * Luật retry chép theo lesson-generate.processor.ts (outline 3 lần; lesson 2 lần lỗi schema +
 * 1 lần lỗi nghiệp vụ) — sửa bên đó thì sửa theo.
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chunkDocument,
  extractJson,
  lessonPrompt,
  outlinePrompt,
  OutlineOutput,
  validateLessonOutput,
  type LessonOutputT,
  type LlmGenerationResult,
  type LlmProvider,
  type OutlineOutputT,
} from '@learn/ai';
import { env } from '../environment';
import { createLlmProvider, estimateCostUsd } from '../common/llm';

interface CallStat {
  step: string;
  attempt: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
}

interface LessonStat {
  node: string;
  ok: boolean;
  attempts: number;
  confidence?: 'HIGH' | 'LOW';
  errors?: string[];
  questions?: number;
  contentChars?: number;
}

const CALL_TIMEOUT_MS = 120_000;
const CONCURRENCY = 3;

async function call(llm: LlmProvider, prompt: string): Promise<LlmGenerationResult> {
  return Promise.race([
    llm.generate({ prompt }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('LLM call timeout (120s)')), CALL_TIMEOUT_MS),
    ),
  ]);
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function runModel(model: string, docPath: string, outDir: string) {
  const llm = createLlmProvider({ ...env, LLM_MODEL_GENERATION: model, LLM_MODEL_FALLBACK: '' });
  const calls: CallStat[] = [];
  const started = Date.now();

  const text = readFileSync(docPath, 'utf8');
  const chunks = chunkDocument(text, {}).map((c) => ({ ...c, id: `chunk-${c.index}` }));
  const chunkContentById = new Map(chunks.map((c) => [c.id, c.content]));
  const availableChunkIds = chunks.map((c) => c.id);

  // ── Outline ──
  let outline: OutlineOutputT | undefined;
  let previousError: string | undefined;
  for (let attempt = 1; attempt <= 3 && !outline; attempt++) {
    const prompt = outlinePrompt({
      language: 'vi',
      previousError,
      chunks: chunks.map((c) => ({
        id: c.id,
        headingPath: c.headingPath ?? '',
        preview: c.content.slice(0, 200),
      })),
    });
    try {
      const res = await call(llm, prompt);
      calls.push({ step: 'outline', attempt, ...pickUsage(res) });
      const parsed = OutlineOutput.safeParse(extractJson(res.text));
      if (parsed.success) outline = parsed.data;
      else
        previousError = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
    } catch (e) {
      previousError = errMsg(e);
      calls.push({
        step: 'outline',
        attempt,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        error: previousError,
      });
    }
  }
  if (!outline) {
    return summarize(model, calls, [], started, `Outline hỏng: ${previousError}`);
  }

  // ── Lessons, song song tối đa CONCURRENCY như worker ──
  const lessons: LessonStat[] = new Array(outline.nodes.length);
  const outputs: Array<LessonOutputT | undefined> = new Array(outline.nodes.length);
  const titles: string[] = [];
  let next = 0;
  const nodes = outline.nodes;
  const workers = Array.from({ length: Math.min(CONCURRENCY, nodes.length) }, async () => {
    while (next < nodes.length) {
      const i = next++;
      const node = nodes[i];
      if (!node) continue;
      const nodeChunks = node.chunkIds
        .filter((id) => chunkContentById.has(id))
        .map((id) => ({ id, content: chunkContentById.get(id) as string }));
      let prev: string | undefined;
      let schemaAttempts = 0;
      let ruleAttempts = 0;
      let stat: LessonStat = { node: node.title, ok: false, attempts: 0 };
      for (let attempt = 1; attempt <= 4; attempt++) {
        stat.attempts = attempt;
        const prompt = lessonPrompt({
          language: 'vi',
          courseTitle: outline.courseTitle,
          nodeTitle: node.title,
          nodeDescription: node.description,
          chunks: nodeChunks,
          previousError: prev,
        });
        let res: LlmGenerationResult;
        try {
          res = await call(llm, prompt);
        } catch (e) {
          // Lỗi gọi API (503/timeout) — worker thật sẽ ném lên và job thất bại/retry cả job.
          calls.push({
            step: `lesson:${node.title}`,
            attempt,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 0,
            error: errMsg(e),
          });
          stat = { ...stat, errors: [errMsg(e)] };
          break;
        }
        calls.push({ step: `lesson:${node.title}`, attempt, ...pickUsage(res) });
        let raw: unknown;
        try {
          raw = extractJson(res.text);
        } catch (e) {
          prev = errMsg(e);
          if (++schemaAttempts > 2) {
            stat.errors = [prev];
            break;
          }
          continue;
        }
        const result = validateLessonOutput(raw, {
          availableChunkIds,
          chunkContentById,
          existingLessonTitles: [...titles],
        });
        if (result.ok) {
          titles.push(result.lesson.title.trim().toLowerCase());
          outputs[i] = result.lesson;
          stat = {
            ...stat,
            ok: true,
            confidence: result.confidence,
            questions: result.lesson.exercises.reduce((n, ex) => n + ex.questions.length, 0),
            contentChars: result.lesson.contentMd.length,
          };
          break;
        }
        prev = result.errors.join('; ');
        stat.errors = result.errors;
        const isSchema = result.errors.some((e) => e.includes(':'));
        if (isSchema ? ++schemaAttempts > 2 : ++ruleAttempts > 1) break;
      }
      lessons[i] = stat;
    }
  });
  await Promise.all(workers);

  const safe = model.replace(/[^\w.-]/g, '_');
  writeFileSync(
    join(outDir, `${safe}.json`),
    JSON.stringify({ model, outline, lessons: outputs, stats: lessons, calls }, null, 2),
  );
  return summarize(model, calls, lessons, started);
}

function pickUsage(res: LlmGenerationResult) {
  return { inputTokens: res.inputTokens, outputTokens: res.outputTokens, latencyMs: res.latencyMs };
}

function summarize(
  model: string,
  calls: CallStat[],
  lessons: LessonStat[],
  started: number,
  fatal?: string,
) {
  const input = calls.reduce((n, c) => n + c.inputTokens, 0);
  const output = calls.reduce((n, c) => n + c.outputTokens, 0);
  return {
    model,
    fatal,
    lessonsOk: lessons.filter((l) => l?.ok).length,
    lessonsTotal: lessons.length,
    lowConfidence: lessons.filter((l) => l?.confidence === 'LOW').length,
    llmCalls: calls.length,
    apiErrors: calls
      .filter((c) => c.error)
      .map((c) => `${c.step}#${c.attempt}: ${c.error?.slice(0, 120)}`),
    inputTokens: input,
    outputTokens: output,
    costUsdNow: Number(estimateCostUsd(model, input, output).toFixed(4)),
    costUsdFrom2027: Number(
      estimateCostUsd(model, input, output, new Date('2027-01-01')).toFixed(4),
    ),
    wallSeconds: Math.round((Date.now() - started) / 1000),
    avgCallSeconds: Number(
      (
        calls.filter((c) => !c.error).reduce((n, c) => n + c.latencyMs, 0) /
        Math.max(1, calls.filter((c) => !c.error).length) /
        1000
      ).toFixed(1),
    ),
    perLesson: lessons.map((l) => ({
      node: l?.node,
      ok: l?.ok,
      attempts: l?.attempts,
      confidence: l?.confidence,
      questions: l?.questions,
      contentChars: l?.contentChars,
      errors: l?.errors?.slice(0, 3),
    })),
  };
}

async function main() {
  const [docPath, outDir, ...models] = process.argv.slice(2);
  if (!docPath || !outDir || models.length === 0) {
    console.error(
      'Cách dùng: compare-models.ts <tài liệu.md> <thư mục kết quả> <model> [model...]',
    );
    process.exit(1);
  }
  if (env.LLM_MODE !== 'live' || !env.LLM_API_KEY) {
    console.error('Cần LLM_MODE=live và LLM_API_KEY trong apps/worker/.env.');
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  // Chạy tuần tự từng model: song song giữa các model làm quota free tier bị chia và số liệu nhiễu.
  const summaries = [];
  for (const model of models) {
    console.error(`▶ ${model}…`);
    summaries.push(await runModel(model, docPath, outDir));
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summaries, null, 2));
  console.log(JSON.stringify(summaries, null, 2));
}

void main();
