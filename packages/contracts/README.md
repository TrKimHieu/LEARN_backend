# @learn/contracts — hợp đồng web ⇄ api (⇄ app mobile)

Schema Zod là nguồn sự thật duy nhất cho hình dạng request/response. API validate bằng chúng, web suy kiểu từ chúng.
Mỗi `src/<mảng>.ts` ứng với một mảng nghiệp vụ: `auth`, `course`, `document`, `lesson`, `exercise`, `progress`,
`subscription`, `admin`, `ai`, `meta`, cùng `common.ts` (mã lỗi, phân trang).

**Đổi file ở đây ⇒** chạy `npm run contracts:hash` (cập nhật `src/version.ts`), sửa `docs/PARITY.md`, và báo bên
app mobile (`LEARN_mobile`: `npm run sync:contracts`).
