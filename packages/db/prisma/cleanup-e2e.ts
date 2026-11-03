/**
 * Dọn tài khoản do e2e tạo ra (email bắt đầu bằng `e2e-`) cùng khóa học và AI Job của chúng.
 * `Course.ownerId` không cascade theo User, nên phải xoá khóa học trước (khóa học tự cascade
 * Document/Lesson/Exercise/…, giống `seed-demo-heavy.ts`).
 *
 * Chạy: npm run db:cleanup:e2e   (chỉ dev — từ chối khi NODE_ENV=production)
 */
import { prisma } from '../src/index';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Không chạy dọn dữ liệu e2e trên production.');
  }
  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'e2e-' } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) {
    console.log('Không có tài khoản e2e nào.');
    return;
  }
  const jobs = await prisma.aIJob.deleteMany({ where: { course: { ownerId: { in: ids } } } });
  const courses = await prisma.course.deleteMany({ where: { ownerId: { in: ids } } });
  const deleted = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(
    `Đã xoá ${deleted.count} tài khoản e2e, ${courses.count} khóa học, ${jobs.count} AI Job.` +
      ' Object tài liệu trên MinIO không bị xoá.',
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
