# apps/api/src — REST API (NestJS)

| Đường dẫn        | Vai trò                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `main.ts`        | Khởi động: middleware, filter lỗi, cổng 4000                                          |
| `app.module.ts`  | Ghép toàn bộ module                                                                   |
| `environment.ts` | Đọc và kiểm tra biến môi trường (Zod); từ chối chạy production với giá trị dev        |
| `core/`          | Nền tảng cho mọi domain: JWT/guard/rate limit (`security`), lỗi chuẩn (`exceptions`)  |
| `infra/`         | Nối hệ thống ngoài: Prisma, Redis, S3, hàng đợi BullMQ, mail, audit log               |
| `domains/`       | **Nghiệp vụ**, mỗi thư mục một domain — xem `domains/README.md`                       |
| `modules/`       | Cắt ngang: `health` (liveness/ready), `meta` (contractsHash, phiên bản app tối thiểu) |
| `bootstrap/`     | Middleware gắn mã vết request                                                         |
| `types/`         | Bổ sung kiểu cho Express                                                              |
