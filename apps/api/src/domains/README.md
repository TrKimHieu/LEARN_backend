# domains/ — nghiệp vụ của API

Mỗi domain (`auth`, `courses`, `documents`, `learning`, `ai`, `subscriptions`, `admin`) có cùng bố cục:

```
<domain>/
├─ <domain>.module.ts           khai báo provider/controller của domain
├─ presentation/                controller + decorator — nhận request, validate bằng Zod, trả response
├─ application/                 service — luật nghiệp vụ, không biết HTTP
└─ infrastructure/repositories/ repository — truy vấn Prisma; LỌC QUYỀN SỞ HỮU Ở ĐÂY (chống IDOR)
```

Luồng một request: `controller → service → repository → Prisma`. Đáp án đúng (`correctAnswer`,
`isCorrect`) không bao giờ rời server trước khi nộp bài.

Ranh giới (ESLint `boundary/no-cross-module-import`): domain này **không import file nội bộ** của domain khác;
chỉ được import `*.module.ts`, `*.service.ts`, `*.repository.ts` của nó.

Thêm endpoint: contract ở `packages/contracts` → controller → service → repository.
