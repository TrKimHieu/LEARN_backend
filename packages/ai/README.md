# @learn/ai — logic AI dùng chung (worker gọi)

- `chunker.ts` — chia tài liệu thành đoạn theo heading/trang
- `prompts/` — prompt `outline` và `lesson`, có số phiên bản (`*_PROMPT_VERSION`; đổi prompt thì tăng)
- `llm/` — provider: `anthropic`, `gemini`, `openai` (tương thích), `mock`, `fallback` (tự chuyển model dự phòng)
- `schemas/output.ts` — hình dạng đầu ra mà LLM phải trả
- `validator/` — kiểm 4 tầng: schema, luật nghiệp vụ, bám nguồn, vệ sinh Markdown
