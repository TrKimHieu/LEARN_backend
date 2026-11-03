/**
 * Seed dữ liệu mẫu — HANDBOOK §6.4. KHÔNG chạy tự động trên production.
 * Tạo: 3 Plan (FREE, PRO, TEAM-tương-lai), 1 admin, 1 learner demo kèm Course+Document+3 Lesson.
 */
import { prisma, newId, hashPassword } from '../src/index';

const PLAN_LIMITS = {
  FREE: {
    COURSES_CREATED: { limit: 3, window: 'total' },
    DOCUMENTS_UPLOADED: { limit: 5, window: 'month' },
    PAGES_PROCESSED: { limit: 50, window: 'per_document' },
    AI_JOBS_RUN: { limit: 10, window: 'month' },
  },
  PRO: {
    COURSES_CREATED: { limit: 50, window: 'total' },
    DOCUMENTS_UPLOADED: { limit: 100, window: 'month' },
    PAGES_PROCESSED: { limit: 300, window: 'per_document' },
    AI_JOBS_RUN: { limit: 200, window: 'month' },
  },
  TEAM: {
    COURSES_CREATED: { limit: 9999, window: 'total' },
    DOCUMENTS_UPLOADED: { limit: 9999, window: 'month' },
    PAGES_PROCESSED: { limit: 9999, window: 'per_document' },
    AI_JOBS_RUN: { limit: 9999, window: 'month' },
  },
} as const;

async function main() {
  console.log('Seed bắt đầu...');

  const plans = [
    {
      code: 'FREE',
      name: 'Free',
      description: 'Bắt đầu với hạn mức cơ bản.',
      priceCents: 0,
      currency: 'USD',
      interval: 'month',
      limits: PLAN_LIMITS.FREE,
      features: ['3 khóa học', '5 tài liệu/tháng', '10 AI job/tháng'],
      displayOrder: 0,
      isFutureExtension: false,
    },
    {
      code: 'PRO',
      name: 'Pro',
      description: 'Cho người học nghiêm túc.',
      priceCents: 900,
      currency: 'USD',
      interval: 'month',
      limits: PLAN_LIMITS.PRO,
      features: ['50 khóa học', '100 tài liệu/tháng', '200 AI job/tháng', 'Hỗ trợ ưu tiên'],
      displayOrder: 1,
      isFutureExtension: false,
    },
    {
      code: 'TEAM',
      name: 'Team',
      description: 'Dành cho tổ chức — mở rộng tương lai.',
      priceCents: 0,
      currency: 'USD',
      interval: 'month',
      limits: PLAN_LIMITS.TEAM,
      features: ['Không giới hạn', 'Quản lý thành viên'],
      displayOrder: 2,
      isFutureExtension: true,
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: {},
      create: plan,
    });
  }

  // Production (server thật — docs/DEPLOY.md): mật khẩu admin BẮT BUỘC từ biến môi trường, không
  // tạo tài khoản demo lẫn khóa học mẫu. Dev giữ nguyên tài khoản quen thuộc cho test/e2e.
  const isProd = process.env.NODE_ENV === 'production';
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@learn.ai';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || (isProd ? '' : 'Admin@12345');
  if (isProd && adminPassword.length < 12) {
    throw new Error('Production: đặt SEED_ADMIN_PASSWORD (ít nhất 12 ký tự) trước khi seed.');
  }

  const adminPw = await hashPassword(adminPassword);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      id: newId(),
      email: adminEmail,
      passwordHash: adminPw,
      displayName: 'Admin LEARN',
      role: 'ADMIN',
      locale: 'vi',
    },
  });

  if (isProd) {
    console.log(
      `Seed production hoàn tất: 3 gói + admin ${adminEmail} (mật khẩu từ SEED_ADMIN_PASSWORD).`,
    );
    return;
  }

  const demoPw = await hashPassword('Demo@12345');
  let demo = await prisma.user.findUnique({ where: { email: 'demo@learn.ai' } });
  if (!demo) {
    demo = await prisma.user.create({
      data: {
        id: newId(),
        email: 'demo@learn.ai',
        passwordHash: demoPw,
        displayName: 'Người học Demo',
        role: 'LEARNER',
        locale: 'vi',
      },
    });
  }

  const freePlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
  await prisma.subscription.upsert({
    where: { id: `${demo.id}-free` },
    update: {},
    create: {
      id: `${demo.id}-free`,
      userId: demo.id,
      planId: freePlan.id,
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  });

  const course = await prisma.course.create({
    data: {
      id: newId(),
      ownerId: demo.id,
      title: 'Lập trình TypeScript cơ bản',
      description: 'Khóa học mẫu từ tài liệu slide nhập môn.',
      language: 'vi',
      status: 'READY',
    },
  });

  const doc = await prisma.document.create({
    data: {
      id: newId(),
      courseId: course.id,
      uploaderId: demo.id,
      filename: 'typescript-intro.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 204800,
      storageKey: `courses/${course.id}/documents/seed-doc.pdf`,
      checksumSha256: 'a'.repeat(64),
      pageCount: 12,
      status: 'EXTRACTED',
      extractedAt: new Date(),
    },
  });

  const chunks = [
    { text: 'TypeScript là siêu tập của JavaScript, bổ sung kiểu tĩnh.', page: 1 },
    { text: 'Kiểu tĩnh giúp phát hiện lỗi ở thời điểm biên dịch.', page: 2 },
    { text: 'Giao diện (interface) mô tả hình dạng của dữ liệu.', page: 3 },
  ];
  for (const [i, c] of chunks.entries()) {
    await prisma.documentChunk.create({
      data: {
        id: newId(),
        documentId: doc.id,
        index: i,
        content: c.text,
        tokenCount: Math.ceil(c.text.length / 4),
        pageFrom: c.page,
        pageTo: c.page,
        headingPath: 'Giới thiệu',
      },
    });
  }

  const lessonTitles = ['Giới thiệu TypeScript', 'Kiểu tĩnh', 'Interface và Object'];
  for (const [i, title] of lessonTitles.entries()) {
    const lesson = await prisma.lesson.create({
      data: {
        id: newId(),
        courseId: course.id,
        documentId: doc.id,
        orderIndex: i,
        title,
        summary: `Tóm tắt bài ${i + 1}: ${title}.`,
        contentMd: `# ${title}\n\nĐây là bài học mẫu được seed sẵn để test và quay demo.\n\n> Nội dung này nằm trong phạm vi tài liệu gốc.`,
        estimatedMinutes: 10,
        status: 'PUBLISHED',
        sourceChunkIds: [doc.id, doc.id, doc.id].slice(0, 1),
        confidence: 'HIGH',
      },
    });

    const exercise = await prisma.exercise.create({
      data: {
        id: newId(),
        lessonId: lesson.id,
        orderIndex: 0,
        title: `Bài tập ${i + 1}`,
        instruction: 'Chọn đáp án đúng.',
        difficulty: 'EASY',
        passScore: 70,
      },
    });

    const q = await prisma.question.create({
      data: {
        id: newId(),
        exerciseId: exercise.id,
        orderIndex: 0,
        type: 'MULTIPLE_CHOICE',
        prompt: `Điều nào đúng về ${title}?`,
        explanation: 'Xem lại nội dung bài học để hiểu rõ hơn.',
        correctAnswer: { optionId: '' },
        points: 1,
      },
    });

    const opts = [
      { label: 'A', content: 'Đáp án đúng mẫu', isCorrect: true },
      { label: 'B', content: 'Đáp án sai mẫu 1', isCorrect: false },
      { label: 'C', content: 'Đáp án sai mẫu 2', isCorrect: false },
      { label: 'D', content: 'Đáp án sai mẫu 3', isCorrect: false },
    ];
    for (const o of opts) {
      const optId = newId();
      if (o.isCorrect) {
        await prisma.question.update({
          where: { id: q.id },
          data: { correctAnswer: { optionId: optId } },
        });
      }
      await prisma.answerOption.create({
        data: {
          id: optId,
          questionId: q.id,
          orderIndex: opts.indexOf(o),
          label: o.label,
          content: o.content,
          isCorrect: o.isCorrect,
        },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      id: newId(),
      actorId: admin.id,
      action: 'db.seed',
      entityType: 'System',
      entityId: 'seed-run',
      metadata: { at: new Date().toISOString() },
    },
  });

  console.log('Seed hoàn tất.');
  console.log(
    `  Admin: ${adminEmail} / ${adminPassword === 'Admin@12345' ? adminPassword : '(SEED_ADMIN_PASSWORD)'}`,
  );
  console.log('  Đemo : demo@learn.ai  / Demo@12345');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
