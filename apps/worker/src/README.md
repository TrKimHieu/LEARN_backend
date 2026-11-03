# apps/worker/src — xử lý nền (BullMQ)

Process riêng, không mở cổng; nhận job từ Redis do API đẩy vào.

| Đường dẫn                                  | Vai trò                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `main.ts`, `worker.module.ts`              | Khởi động; tắt êm khi nhận SIGTERM (chờ job đang chạy xong)                             |
| `processors/document-extract.processor.ts` | Trích chữ từ tài liệu → chunk → ghi `DocumentChunk`                                     |
| `processors/lesson-generate.processor.ts`  | outline → sinh bài + bài tập song song → validate 4 tầng → ghi DB → báo tiến độ         |
| `extraction/`                              | PDF (`pdf.ts`, `pdf-layout.ts`), DOCX/PPTX (`office.ts`), điều phối (`extract-text.ts`) |
| `common/`                                  | Chọn LLM provider + ước tính chi phí, publish tiến độ qua Redis, S3                     |
| `scripts/compare-models.ts`                | Công cụ dev: so sánh model trên cùng đầu vào                                            |

`LLM_MODE=mock` (giá trị trong `.env.example`) dùng dữ liệu mẫu ở `../fixtures/`, không tốn tiền.
Logic AI dùng chung (chunker, prompt, provider, validator) nằm ở `packages/ai`.
