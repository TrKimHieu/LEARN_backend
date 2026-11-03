import {
  LlmUnavailableError,
  type LlmGenerateParams,
  type LlmGenerationResult,
  type LlmProvider,
} from './provider';

/**
 * Bọc một provider: khi model chính tạm không dùng được (LlmUnavailableError — quá tải, hết quota)
 * thì gọi lại đúng prompt đó bằng `fallbackModel` trên cùng nhà cung cấp. Lỗi khác ném thẳng.
 *
 * `result.model` là model thực sự đã trả lời, nên GenerationRun và ước tính chi phí tự đúng theo
 * model dự phòng mà pipeline không phải biết đã có chuyển model.
 */
export class FallbackLlmProvider implements LlmProvider {
  readonly defaultModel: string;

  constructor(
    private readonly primary: LlmProvider,
    private readonly fallbackModel: string,
    private readonly onFallback?: (err: LlmUnavailableError, from: string, to: string) => void,
  ) {
    this.defaultModel = primary.defaultModel;
  }

  async generate(params: LlmGenerateParams): Promise<LlmGenerationResult> {
    const requested = params.model ?? this.primary.defaultModel;
    try {
      return await this.primary.generate(params);
    } catch (err) {
      if (!(err instanceof LlmUnavailableError) || requested === this.fallbackModel) throw err;
      this.onFallback?.(err, requested, this.fallbackModel);
      return this.primary.generate({ ...params, model: this.fallbackModel });
    }
  }
}
