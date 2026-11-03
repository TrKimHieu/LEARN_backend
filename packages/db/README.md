# @learn/db — Prisma

- `prisma/schema.prisma` — nguồn sự thật của database
- `prisma/migrations/` — lịch sử migration (`npm run db:migrate` khi dev, `db:deploy` khi deploy)
- `prisma/seed.ts` — tài khoản admin + demo; `seed-demo-heavy.ts` — dữ liệu nặng để thử; `cleanup-e2e.ts` — dọn dữ liệu test
- `src/index.ts` — Prisma client dùng chung cho api + worker, `newId`, băm/kiểm mật khẩu (argon2)
- `generated/` — client do Prisma sinh, **không sửa tay** (`npm run db:generate`)
