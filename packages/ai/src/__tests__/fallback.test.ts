import { describe, it, expect } from 'vitest';
import { FallbackLlmProvider } from '../llm/fallback';
import {
  LlmUnavailableError,
  type LlmGenerateParams,
  type LlmGenerationResult,
  type LlmProvider,
} from '../llm/provider';

/**
 * Provider giả theo kịch bản: mỗi model trả kết quả hoặc ném lỗi định sẵn, ghi lại model đã được
 * gọi theo thứ tự. Không dùng mock framework — chỉ là một LlmProvider thật tối giản.
 */
function scriptedProvider(script: Record<string, Error | 'ok'>, defaultModel = 'primary') {
  const calledModels: string[] = [];
  const provider: LlmProvider = {
    defaultModel,
    async generate(params: LlmGenerateParams): Promise<LlmGenerationResult> {
      const model = params.model ?? defaultModel;
      calledModels.push(model);
      const outcome = script[model];
      if (outcome instanceof Error) throw outcome;
      if (outcome !== 'ok') throw new Error(`kịch bản không có model ${model}`);
      return { text: `từ ${model}`, inputTokens: 1, outputTokens: 1, latencyMs: 1, model };
    },
  };
  return { provider, calledModels };
}

describe('FallbackLlmProvider', () => {
  it('model chính trả lời được thì không đụng tới model dự phòng', async () => {
    const { provider, calledModels } = scriptedProvider({ primary: 'ok', backup: 'ok' });
    const llm = new FallbackLlmProvider(provider, 'backup');

    const res = await llm.generate({ prompt: 'x' });

    expect(res.model).toBe('primary');
    expect(calledModels).toEqual(['primary']);
  });

  it('model chính tạm không dùng được (503/429) → gọi lại cùng prompt bằng model dự phòng', async () => {
    const { provider, calledModels } = scriptedProvider({
      primary: new LlmUnavailableError('quá tải', 503),
      backup: 'ok',
    });
    const switches: Array<{ from: string; to: string; status: number }> = [];
    const llm = new FallbackLlmProvider(provider, 'backup', (err, from, to) =>
      switches.push({ from, to, status: err.status }),
    );

    const res = await llm.generate({ prompt: 'x' });

    expect(res.text).toBe('từ backup');
    expect(res.model).toBe('backup');
    expect(calledModels).toEqual(['primary', 'backup']);
    expect(switches).toEqual([{ from: 'primary', to: 'backup', status: 503 }]);
  });

  it('lỗi không phải tạm thời (sai cấu hình, sai key) ném thẳng, không phí lượt dự phòng', async () => {
    const { provider, calledModels } = scriptedProvider({
      primary: new Error('Gemini 404 NOT_FOUND'),
      backup: 'ok',
    });
    const llm = new FallbackLlmProvider(provider, 'backup');

    await expect(llm.generate({ prompt: 'x' })).rejects.toThrow(/404/);
    expect(calledModels).toEqual(['primary']);
  });

  it('model dự phòng cũng lỗi → ném lỗi của model dự phòng', async () => {
    const { provider } = scriptedProvider({
      primary: new LlmUnavailableError('quá tải', 503),
      backup: new LlmUnavailableError('hết quota', 429),
    });
    const llm = new FallbackLlmProvider(provider, 'backup');

    await expect(llm.generate({ prompt: 'x' })).rejects.toThrow(/hết quota/);
  });

  it('lời gọi đã chỉ định đúng model dự phòng thì không gọi lại chính nó', async () => {
    const { provider, calledModels } = scriptedProvider({
      backup: new LlmUnavailableError('quá tải', 503),
    });
    const llm = new FallbackLlmProvider(provider, 'backup');

    await expect(llm.generate({ prompt: 'x', model: 'backup' })).rejects.toThrow(/quá tải/);
    expect(calledModels).toEqual(['backup']);
  });

  it('giữ nguyên defaultModel của provider chính', () => {
    const { provider } = scriptedProvider({}, 'gemini-3.8-flash');
    expect(new FallbackLlmProvider(provider, 'gemini-3.1-flash-lite').defaultModel).toBe(
      'gemini-3.8-flash',
    );
  });
});
