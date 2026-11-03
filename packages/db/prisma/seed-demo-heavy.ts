/**
 * Bơm dữ liệu LỚN cho demo@learn.ai — mô phỏng một người dùng thật đã dùng sản phẩm
 * nhiều tuần: 6 khoá học đa chủ đề (một cái đang DRAFT, một cái đã ARCHIVED), gần 90
 * bài học+bài tập, streak làm bài liên tục ~13 ngày, và nâng demo lên gói PRO.
 *
 * Idempotent: xoá sạch Course cũ của demo (cascade dọn Document/Lesson/Exercise/
 * Question/AnswerOption/Submission/AIJob) rồi dựng lại từ đầu, nên chạy lại bao
 * nhiêu lần cũng ra cùng một trạng thái — không cộng dồn.
 *
 * Yêu cầu: `npm run db:seed` đã chạy trước (tạo demo@learn.ai + 3 Plan).
 * Chạy: npm run db:seed:demo
 */
import { prisma, newId } from '../src/index';

const TZ_OFFSET_HOURS = 7; // Asia/Ho_Chi_Minh, không có giờ mùa hè.
const STREAK_DAYS = 13;

type YMD = { y: number; m: number; d: number };

function todayInTZ(): YMD {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = parts.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

function addDays(day: YMD, delta: number): YMD {
  const dt = new Date(Date.UTC(day.y, day.m - 1, day.d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * Thời điểm cụ thể tính theo giờ Việt Nam, quy đổi đúng cách progress.service.ts đọc lại:
 * cột `createdAt` không mang múi giờ, Prisma ghi thẳng giá trị UTC của Date vào đó, và câu
 * truy vấn streak diễn giải giá trị ấy là UTC rồi cộng +7h. Nên muốn "ngày địa phương D, giờ H"
 * thì phải ghi xuống DB con số (D, H-7h).
 */
function localMoment(day: YMD, hour: number, minute = 0): Date {
  return new Date(
    Date.UTC(day.y, day.m - 1, day.d, hour, minute, 0) - TZ_OFFSET_HOURS * 3600 * 1000,
  );
}

function offsetToDate(offsetDays: number, hour: number, minute = 0): Date {
  return localMoment(addDays(todayInTZ(), -offsetDays), hour, minute);
}

// ─── Nội dung khoá học ────────────────────────────────────────────────────

interface LessonSpec {
  title: string;
  fact: string;
}
interface CourseSpec {
  title: string;
  description: string;
  status: 'DRAFT' | 'READY' | 'ARCHIVED';
  createdDaysAgo: number;
  filename: string;
  lessons: LessonSpec[];
}

const COURSES: CourseSpec[] = [
  {
    title: 'Lập trình TypeScript cơ bản',
    description: 'Khóa học mẫu từ tài liệu slide nhập môn.',
    status: 'READY',
    createdDaysAgo: 52,
    filename: 'typescript-intro.pdf',
    lessons: [
      {
        title: 'Giới thiệu TypeScript',
        fact: 'TypeScript là siêu tập của JavaScript, bổ sung kiểu tĩnh.',
      },
      { title: 'Kiểu tĩnh', fact: 'Kiểu tĩnh giúp phát hiện lỗi ở thời điểm biên dịch.' },
      { title: 'Interface và Object', fact: 'Interface mô tả hình dạng của dữ liệu.' },
      {
        title: 'Generic cơ bản',
        fact: 'Generic cho phép viết code dùng lại được với nhiều kiểu dữ liệu khác nhau.',
      },
      {
        title: 'Union và Intersection Type',
        fact: 'Union type (A | B) nghĩa là giá trị có thể là A hoặc B.',
      },
      {
        title: 'Enum và Literal Type',
        fact: 'Enum đặt tên cho một tập giá trị cố định, dễ đọc hơn số rời rạc.',
      },
      {
        title: 'Module và Namespace',
        fact: 'Module dùng import/export để chia code thành nhiều file quản lý được.',
      },
      {
        title: 'Cấu hình tsconfig',
        fact: 'tsconfig.json quyết định trình biên dịch kiểm tra nghiêm ngặt tới đâu.',
      },
    ],
  },
  {
    title: 'Python cho người mới bắt đầu',
    description: 'Nhập môn Python qua ví dụ thực hành, từ biến tới lập trình hướng đối tượng.',
    status: 'READY',
    createdDaysAgo: 45,
    filename: 'python-co-ban.pdf',
    lessons: [
      {
        title: 'Biến và kiểu dữ liệu',
        fact: 'Python không cần khai báo kiểu — biến nhận kiểu theo giá trị gán.',
      },
      {
        title: 'Câu lệnh điều kiện',
        fact: 'if/elif/else rẽ nhánh chương trình dựa trên điều kiện đúng/sai.',
      },
      {
        title: 'Vòng lặp for và while',
        fact: 'for lặp qua một dãy có sẵn, while lặp tới khi điều kiện sai.',
      },
      { title: 'Hàm và tham số', fact: 'def khai báo hàm; tham số có thể có giá trị mặc định.' },
      {
        title: 'List và Dictionary',
        fact: 'List lưu dãy có thứ tự, Dictionary lưu cặp khóa-giá trị.',
      },
      {
        title: 'Xử lý ngoại lệ',
        fact: 'try/except bắt lỗi runtime để chương trình không dừng đột ngột.',
      },
      {
        title: 'Làm việc với file',
        fact: 'open() mở file; with đảm bảo file được đóng đúng cách.',
      },
      {
        title: 'Lập trình hướng đối tượng cơ bản',
        fact: 'class định nghĩa kiểu dữ liệu mới gồm thuộc tính và phương thức.',
      },
      {
        title: 'Thư viện chuẩn thường dùng',
        fact: 'os, json, datetime là các thư viện chuẩn hay dùng nhất.',
      },
    ],
  },
  {
    title: 'Tiếng Anh giao tiếp công sở',
    description: 'Từ vựng và mẫu câu dùng trong môi trường làm việc quốc tế.',
    status: 'READY',
    createdDaysAgo: 38,
    filename: 'tieng-anh-cong-so.pdf',
    lessons: [
      {
        title: 'Chào hỏi và giới thiệu bản thân',
        fact: '"Nice to meet you" là câu chào chuẩn khi gặp đồng nghiệp mới.',
      },
      {
        title: 'Viết email chuyên nghiệp',
        fact: 'Email công việc nên mở đầu rõ mục đích trong 1-2 câu đầu.',
      },
      { title: 'Đặt lịch họp', fact: '"Does this time work for you?" dùng để xác nhận lịch họp.' },
      {
        title: 'Thuyết trình cơ bản',
        fact: 'Mở đầu bài thuyết trình nên nêu rõ agenda sẽ trình bày.',
      },
      {
        title: 'Đàm phán và thương lượng',
        fact: '"Let\'s find a middle ground" là cách đề xuất thỏa hiệp lịch sự.',
      },
      {
        title: 'Từ vựng họp hành',
        fact: '"Follow up" nghĩa là theo dõi/tiếp tục xử lý sau cuộc họp.',
      },
      {
        title: 'Phản hồi và góp ý',
        fact: 'Phản hồi mang tính xây dựng nên bắt đầu bằng điểm tích cực.',
      },
      {
        title: 'Gọi điện thoại công việc',
        fact: '"Could you repeat that, please?" dùng khi nghe không rõ qua điện thoại.',
      },
      {
        title: 'Networking sự kiện',
        fact: '"What do you do?" là câu hỏi mở đầu phổ biến khi networking.',
      },
      { title: 'Viết báo cáo ngắn', fact: 'Báo cáo ngắn nên có phần tóm tắt (summary) ở đầu.' },
    ],
  },
  {
    title: 'Excel nâng cao cho dân văn phòng',
    description: 'Các hàm và công cụ Excel giúp xử lý dữ liệu nhanh hơn trong công việc hằng ngày.',
    status: 'READY',
    createdDaysAgo: 30,
    filename: 'excel-nang-cao.pdf',
    lessons: [
      {
        title: 'Hàm VLOOKUP và INDEX MATCH',
        fact: 'INDEX MATCH linh hoạt hơn VLOOKUP vì tra cứu được cả hai chiều.',
      },
      {
        title: 'PivotTable cơ bản',
        fact: 'PivotTable tổng hợp dữ liệu lớn thành bảng tóm tắt chỉ bằng kéo-thả.',
      },
      {
        title: 'Conditional Formatting',
        fact: 'Conditional Formatting tô màu ô tự động theo điều kiện đặt trước.',
      },
      {
        title: 'Biểu đồ trực quan hóa dữ liệu',
        fact: 'Chọn đúng loại biểu đồ giúp người đọc hiểu dữ liệu nhanh hơn.',
      },
      {
        title: 'Macro và tự động hóa cơ bản',
        fact: 'Macro ghi lại thao tác lặp lại để chạy tự động bằng một nút bấm.',
      },
      {
        title: 'Power Query nhập môn',
        fact: 'Power Query gộp và làm sạch dữ liệu từ nhiều nguồn trước khi phân tích.',
      },
    ],
  },
  {
    title: 'Machine Learning nhập môn',
    description: 'Khái niệm nền tảng của Machine Learning — đang xây dựng thêm bài học.',
    status: 'DRAFT',
    createdDaysAgo: 9,
    filename: 'machine-learning-nhap-mon.pdf',
    lessons: [
      {
        title: 'Machine Learning là gì',
        fact: 'Machine Learning là quá trình máy học từ dữ liệu thay vì lập trình luật cứng.',
      },
      {
        title: 'Học có giám sát và không giám sát',
        fact: 'Học có giám sát dùng dữ liệu đã gán nhãn, học không giám sát thì không.',
      },
      {
        title: 'Hồi quy tuyến tính',
        fact: 'Hồi quy tuyến tính dự đoán một giá trị số dựa trên quan hệ tuyến tính.',
      },
      {
        title: 'Cây quyết định',
        fact: 'Cây quyết định chia dữ liệu qua các câu hỏi rẽ nhánh liên tiếp.',
      },
      {
        title: 'Đánh giá mô hình',
        fact: 'Accuracy, precision và recall là các chỉ số phổ biến để đánh giá mô hình.',
      },
    ],
  },
  {
    title: 'Lịch sử Việt Nam qua các triều đại',
    description: 'Tổng quan các giai đoạn lịch sử chính từ Bắc thuộc tới thời cận đại.',
    status: 'ARCHIVED',
    createdDaysAgo: 150,
    filename: 'lich-su-viet-nam.pdf',
    lessons: [
      {
        title: 'Thời kỳ Bắc thuộc',
        fact: 'Thời Bắc thuộc kéo dài hơn nghìn năm với nhiều cuộc khởi nghĩa giành độc lập.',
      },
      {
        title: 'Nhà Lý và Phật giáo',
        fact: 'Nhà Lý dời đô về Thăng Long năm 1010, Phật giáo phát triển mạnh.',
      },
      {
        title: 'Nhà Trần và ba lần kháng Nguyên Mông',
        fact: 'Nhà Trần ba lần đánh bại quân Nguyên Mông trong thế kỷ 13.',
      },
      {
        title: 'Nhà Nguyễn và thời cận đại',
        fact: 'Nhà Nguyễn là triều đại phong kiến cuối cùng của Việt Nam.',
      },
    ],
  },
];

// ─── Sinh câu hỏi ───────────────────────────────────────────────────────

interface QuestionSpec {
  type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  prompt: string;
  explanation: string;
  options?: string[]; // options[0] luôn là đáp án đúng
}

function questionsFor(lessonTitle: string, fact: string): QuestionSpec[] {
  return [
    {
      type: 'MULTIPLE_CHOICE',
      prompt: `Điều nào sau đây đúng khi nói về "${lessonTitle}"?`,
      explanation: fact,
      options: [
        fact,
        'Không liên quan tới nội dung đã học ở bài này.',
        'Đúng một phần nhưng thiếu ngữ cảnh quan trọng.',
        'Ngược lại hoàn toàn với nội dung bài học.',
      ],
    },
    {
      type: 'MULTIPLE_CHOICE',
      prompt: `Ý nào KHÔNG thuộc nội dung bài "${lessonTitle}"?`,
      explanation: 'Ba lựa chọn còn lại đều nằm trong nội dung bài học, chỉ có một ý lạc đề.',
      options: [
        'Một khái niệm không nằm trong tài liệu nguồn của bài này.',
        fact,
        `Ví dụ minh họa cho "${lessonTitle}".`,
        `Tóm tắt ngắn gọn của "${lessonTitle}".`,
      ],
    },
    {
      type: 'TRUE_FALSE',
      prompt: `${fact} — Đúng hay sai?`,
      explanation: fact,
    },
    {
      type: 'MULTIPLE_CHOICE',
      prompt: `Bài "${lessonTitle}" thuộc phần nào của khóa học?`,
      explanation: 'Dựa trên cách AI phân đoạn tài liệu nguồn thành từng bài học.',
      options: [
        'Phần nội dung chính, xây dựng trực tiếp từ tài liệu gốc.',
        'Phụ lục không bắt buộc.',
        'Tài liệu tham khảo bên ngoài.',
        'Bài kiểm tra tổng kết cuối khóa.',
      ],
    },
  ];
}

interface QuestionRef {
  id: string;
  type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  correctOptionId?: string;
  wrongOptionId?: string;
}

async function createExerciseFor(lessonId: string, lessonTitle: string, fact: string) {
  const exercise = await prisma.exercise.create({
    data: {
      id: newId(),
      lessonId,
      orderIndex: 0,
      title: `Bài tập: ${lessonTitle}`,
      instruction: 'Chọn đáp án đúng cho mỗi câu.',
      difficulty: 'MEDIUM',
      passScore: 70,
    },
  });

  const specs = questionsFor(lessonTitle, fact);
  const refs: QuestionRef[] = [];

  for (const [i, spec] of specs.entries()) {
    if (spec.type === 'TRUE_FALSE') {
      const q = await prisma.question.create({
        data: {
          id: newId(),
          exerciseId: exercise.id,
          orderIndex: i,
          type: 'TRUE_FALSE',
          prompt: spec.prompt,
          explanation: spec.explanation,
          correctAnswer: { value: true },
          points: 1,
        },
      });
      refs.push({ id: q.id, type: 'TRUE_FALSE' });
      continue;
    }

    const q = await prisma.question.create({
      data: {
        id: newId(),
        exerciseId: exercise.id,
        orderIndex: i,
        type: 'MULTIPLE_CHOICE',
        prompt: spec.prompt,
        explanation: spec.explanation,
        correctAnswer: { optionId: '' },
        points: 1,
      },
    });

    const labels = ['A', 'B', 'C', 'D'];
    let correctOptionId = '';
    let wrongOptionId = '';
    for (const [idx, content] of spec.options!.entries()) {
      const optId = newId();
      if (idx === 0) correctOptionId = optId;
      if (idx === 1) wrongOptionId = optId;
      await prisma.answerOption.create({
        data: {
          id: optId,
          questionId: q.id,
          orderIndex: idx,
          label: labels[idx]!,
          content,
          isCorrect: idx === 0,
        },
      });
    }
    await prisma.question.update({
      where: { id: q.id },
      data: { correctAnswer: { optionId: correctOptionId } },
    });
    refs.push({ id: q.id, type: 'MULTIPLE_CHOICE', correctOptionId, wrongOptionId });
  }

  return { exercise, questions: refs };
}

/** N câu đầu đúng, phần còn lại sai — đủ tạo điểm 0/25/50/75/100 (4 câu, mỗi câu 1 điểm). */
async function submitAttempt(
  userId: string,
  exerciseId: string,
  questions: QuestionRef[],
  numCorrect: number,
  attemptNo: number,
  createdAt: Date,
): Promise<{ score: number; passed: boolean; createdAt: Date }> {
  const submissionId = newId();
  const score = numCorrect * 25;
  const passed = score >= 70;

  await prisma.submission.create({
    data: {
      id: submissionId,
      userId,
      exerciseId,
      attemptNo,
      score,
      maxScore: 100,
      durationMs: 20_000 + numCorrect * 4_000,
      createdAt,
    },
  });

  await prisma.submissionAnswer.createMany({
    data: questions.map((q, i) => {
      const isCorrect = i < numCorrect;
      const raw =
        q.type === 'TRUE_FALSE'
          ? { value: isCorrect }
          : { optionId: isCorrect ? q.correctOptionId : q.wrongOptionId };
      return {
        id: newId(),
        submissionId,
        questionId: q.id,
        rawAnswer: raw,
        isCorrect,
        pointsEarned: isCorrect ? 1 : 0,
      };
    }),
  });

  return { score, passed, createdAt };
}

// ─── Lịch trình ngày-giờ cho các lượt nộp bài ──────────────────────────────

type Outcome = 'mastered' | 'retried' | 'in_progress' | 'not_started';

function outcomeFor(status: CourseSpec['status'], lessonIndex: number, total: number): Outcome {
  if (status === 'ARCHIVED') return 'mastered';
  const isLast = lessonIndex === total - 1;
  if (status === 'DRAFT') {
    if (isLast) return 'not_started';
    if (lessonIndex === total - 2) return 'in_progress';
    return lessonIndex % 3 === 2 ? 'retried' : 'mastered';
  }
  if (isLast) return 'in_progress';
  return lessonIndex % 4 === 2 ? 'retried' : 'mastered';
}

/** numCorrect (trên 4 câu) cho từng lượt nộp của một outcome, theo thứ tự thời gian. */
function attemptsFor(outcome: Outcome, lessonIndex: number): number[] {
  const passHigh = lessonIndex % 2 === 0 ? 4 : 3; // 100% hoặc 75% — cả hai đều qua (>=70).
  const failLow = lessonIndex % 2 === 0 ? 2 : 1; // 50% hoặc 25% — cả hai đều trượt.
  switch (outcome) {
    case 'mastered':
      return [passHigh];
    case 'retried':
      return [failLow, passHigh];
    case 'in_progress':
      return [failLow];
    case 'not_started':
      return [];
  }
}

interface PendingAttempt {
  id: string; // khoá tạm để gán offset, không phải id DB
  courseKey: string;
  courseCreatedDaysAgo: number;
  lessonId: string;
  lessonIndex: number;
  exerciseId: string;
  questions: QuestionRef[];
  numCorrect: number;
  attemptNo: number;
}

async function main() {
  console.log('Seed dữ liệu lớn cho demo bắt đầu...');

  const demo = await prisma.user.findUnique({ where: { email: 'demo@learn.ai' } });
  if (!demo) {
    throw new Error('Chưa có demo@learn.ai — chạy `npm run db:seed` trước.');
  }

  // Dọn sạch dữ liệu cũ của demo (cascade Document/Lesson/Exercise/Question/AnswerOption/
  // Submission/SubmissionAnswer/AIJob/GenerationRun/LearningProgress qua khoá ngoại tới Course).
  await prisma.course.deleteMany({ where: { ownerId: demo.id } });
  await prisma.usageCounter.deleteMany({ where: { userId: demo.id } });

  // Nâng demo lên gói PRO — người dùng dùng nhiều tuần thường đã nâng cấp.
  const proPlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
  await prisma.subscription.updateMany({
    where: { userId: demo.id },
    data: { status: 'CANCELED', cancelAtPeriodEnd: true },
  });
  await prisma.subscription.upsert({
    where: { id: `${demo.id}-pro` },
    update: {
      status: 'ACTIVE',
      planId: proPlan.id,
      cancelAtPeriodEnd: false,
      currentPeriodStart: offsetToDate(20, 9),
      currentPeriodEnd: offsetToDate(-10, 9),
    },
    create: {
      id: `${demo.id}-pro`,
      userId: demo.id,
      planId: proPlan.id,
      status: 'ACTIVE',
      currentPeriodStart: offsetToDate(20, 9),
      currentPeriodEnd: offsetToDate(-10, 9),
    },
  });

  const pendingByCourse = new Map<string, PendingAttempt[]>();
  const archivedAttempts: Array<PendingAttempt & { fixedOffset: number }> = [];
  let aiJobCount = 0;
  let documentCount = 0;

  for (const spec of COURSES) {
    const courseCreatedAt = offsetToDate(spec.createdDaysAgo, 10);
    const course = await prisma.course.create({
      data: {
        id: newId(),
        ownerId: demo.id,
        title: spec.title,
        description: spec.description,
        language: 'vi',
        status: spec.status,
        createdAt: courseCreatedAt,
        updatedAt: courseCreatedAt,
      },
    });

    const doc = await prisma.document.create({
      data: {
        id: newId(),
        courseId: course.id,
        uploaderId: demo.id,
        filename: spec.filename,
        mimeType: 'application/pdf',
        sizeBytes: 180_000 + spec.lessons.length * 15_000,
        storageKey: `courses/${course.id}/documents/seed-doc.pdf`,
        checksumSha256: newId().replace(/-/g, '').padEnd(64, '0'),
        pageCount: spec.lessons.length * 4,
        status: 'EXTRACTED',
        extractedAt: courseCreatedAt,
        createdAt: courseCreatedAt,
      },
    });
    documentCount += 1;

    for (const [i, l] of spec.lessons.entries()) {
      await prisma.documentChunk.create({
        data: {
          id: newId(),
          documentId: doc.id,
          index: i,
          content: l.fact,
          tokenCount: Math.ceil(l.fact.length / 4),
          pageFrom: i + 1,
          pageTo: i + 1,
          headingPath: l.title,
        },
      });
    }

    // AIJob mô phỏng lượt sinh bài học ban đầu bằng AI.
    const aiJob = await prisma.aIJob.create({
      data: {
        id: newId(),
        courseId: course.id,
        documentId: doc.id,
        requestedById: demo.id,
        type: 'GENERATE_LESSONS',
        status: 'SUCCEEDED',
        progress: 100,
        progressLabel: 'Hoàn tất',
        attempt: 1,
        idempotencyKey: `seed-demo-${course.id}`,
        inputParams: { lessonCount: spec.lessons.length },
        queuedAt: courseCreatedAt,
        startedAt: courseCreatedAt,
        finishedAt: new Date(courseCreatedAt.getTime() + 90_000),
      },
    });
    aiJobCount += 1;
    await prisma.generationRun.create({
      data: {
        id: newId(),
        aiJobId: aiJob.id,
        step: 'generate_lessons',
        model: 'gemini-2.5-flash',
        promptVersion: 'v1',
        inputTokens: 1800 + spec.lessons.length * 220,
        outputTokens: 900 + spec.lessons.length * 180,
        costUsd: (
          0.0006 * (1800 + spec.lessons.length * 220) +
          0.0024 * (900 + spec.lessons.length * 180)
        ).toFixed(6),
        latencyMs: 4200 + spec.lessons.length * 300,
        attempt: 1,
        createdAt: courseCreatedAt,
      },
    });

    const pending: PendingAttempt[] = [];
    for (const [i, l] of spec.lessons.entries()) {
      const outcome = outcomeFor(spec.status, i, spec.lessons.length);
      const lesson = await prisma.lesson.create({
        data: {
          id: newId(),
          courseId: course.id,
          documentId: doc.id,
          aiJobId: aiJob.id,
          orderIndex: i,
          title: l.title,
          summary: `Tóm tắt: ${l.fact}`,
          contentMd: `# ${l.title}\n\n${l.fact}\n\nBài học được sinh tự động từ tài liệu nguồn, có thể chỉnh sửa lại nội dung này.`,
          estimatedMinutes: 8 + (i % 3) * 4,
          status: 'PUBLISHED',
          sourceChunkIds: [doc.id],
          confidence: outcome === 'not_started' ? 'LOW' : 'HIGH',
          createdAt: courseCreatedAt,
          updatedAt: courseCreatedAt,
        },
      });

      const { exercise, questions } = await createExerciseFor(lesson.id, l.title, l.fact);

      const numCorrectList = attemptsFor(outcome, i);
      numCorrectList.forEach((numCorrect, attemptIdx) => {
        const item: PendingAttempt = {
          id: newId(),
          courseKey: spec.title,
          courseCreatedDaysAgo: spec.createdDaysAgo,
          lessonId: lesson.id,
          lessonIndex: i,
          exerciseId: exercise.id,
          questions,
          numCorrect,
          attemptNo: attemptIdx + 1,
        };
        if (spec.status === 'ARCHIVED') {
          // Khoá học đã lưu trữ: học xong từ lâu, không thuộc lịch trình streak gần đây.
          const fixedOffset = spec.createdDaysAgo - 5 - i * 5 - attemptIdx * 2;
          archivedAttempts.push({ ...item, fixedOffset });
        } else {
          pending.push(item);
        }
      });
    }
    pendingByCourse.set(spec.title, pending);
  }

  // ─── Gán ngày cho các lượt nộp bài (khoá học đang hoạt động) ─────────────
  //
  // Mục tiêu: 13 ngày gần nhất (kể cả hôm nay) mỗi ngày có ít nhất 1 lượt nộp, để
  // `activeStreak` (progress.service.ts) tính ra một chuỗi liên tục thật sự — còn
  // các lượt cũ hơn thì trải thưa dần về quá khứ cho có chiều sâu lịch sử.
  const courseKeys = [...pendingByCourse.keys()];
  const offsetOf = new Map<string, number>();
  const used = new Set<string>();

  // Gộp "vài lượt gần nhất" của mỗi khoá học, xen kẽ theo khoá học, mới nhất trước.
  const recentPool: PendingAttempt[] = [];
  const RECENT_PER_COURSE = 3;
  for (let back = 0; back < RECENT_PER_COURSE; back++) {
    for (const key of courseKeys) {
      const arr = pendingByCourse.get(key)!;
      const item = arr[arr.length - 1 - back];
      if (item) recentPool.push(item);
    }
  }
  for (let offset = 0; offset < STREAK_DAYS && recentPool.length > 0; offset++) {
    const item = recentPool.shift()!;
    offsetOf.set(item.id, offset);
    used.add(item.id);
  }

  // Phần còn lại của mỗi khoá học: trải đều từ ngày tạo khoá học (xa) về ngày 13 (gần).
  for (const key of courseKeys) {
    const remaining = pendingByCourse.get(key)!.filter((a) => !used.has(a.id));
    const n = remaining.length;
    remaining.forEach((item, i) => {
      const span = Math.max(item.courseCreatedDaysAgo - STREAK_DAYS, 0);
      const offset =
        n <= 1 ? item.courseCreatedDaysAgo : STREAK_DAYS + Math.round(span * (1 - i / (n - 1)));
      offsetOf.set(item.id, offset);
    });
  }

  // ─── Ghi Submission + cập nhật LearningProgress ──────────────────────────
  const byLesson = new Map<string, { attempts: PendingAttempt[]; offsets: number[] }>();
  const allActive = courseKeys.flatMap((k) => pendingByCourse.get(k)!);
  for (const item of allActive) {
    const key = item.lessonId;
    const entry = byLesson.get(key) ?? { attempts: [], offsets: [] };
    entry.attempts.push(item);
    entry.offsets.push(offsetOf.get(item.id)!);
    byLesson.set(key, entry);
  }
  for (const item of archivedAttempts) {
    const key = item.lessonId;
    const entry = byLesson.get(key) ?? { attempts: [], offsets: [] };
    entry.attempts.push(item);
    entry.offsets.push(item.fixedOffset);
    byLesson.set(key, entry);
  }

  let submissionCount = 0;
  let completedLessons = 0;
  let inProgressLessons = 0;

  for (const { attempts, offsets } of byLesson.values()) {
    // attempts đã được đẩy vào theo đúng thứ tự thời gian (fail trước, pass sau) khi tạo,
    // nên offset giảm dần đúng thứ tự — chỉ cần map song song hai mảng.
    const results: Array<{ score: number; passed: boolean; createdAt: Date }> = [];
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i]!;
      const offset = offsets[i]!;
      const hour = 19 + (i % 3); // học buổi tối là chủ yếu.
      const minute = (a.lessonIndex * 17 + i * 11) % 60;
      const createdAt = offsetToDate(offset, hour, minute);
      const r = await submitAttempt(
        demo.id,
        a.exerciseId,
        a.questions,
        a.numCorrect,
        a.attemptNo,
        createdAt,
      );
      results.push(r);
      submissionCount += 1;
    }
    if (results.length === 0) continue;

    const bestScore = Math.max(...results.map((r) => r.score));
    const firstPass = results.find((r) => r.passed);
    const status = firstPass ? 'COMPLETED' : 'IN_PROGRESS';
    if (status === 'COMPLETED') completedLessons += 1;
    else inProgressLessons += 1;

    const first = attempts[0]!;
    await prisma.learningProgress.upsert({
      where: { userId_lessonId: { userId: demo.id, lessonId: first.lessonId } },
      update: {},
      create: {
        id: newId(),
        userId: demo.id,
        courseId: (
          await prisma.lesson.findUniqueOrThrow({
            where: { id: first.lessonId },
            select: { courseId: true },
          })
        ).courseId,
        lessonId: first.lessonId,
        status,
        bestScore,
        attempts: results.length,
        startedAt: results[0]!.createdAt,
        completedAt: firstPass ? firstPass.createdAt : null,
      },
    });
  }

  // Usage counter tháng này — DOCUMENTS_UPLOADED và AI_JOBS_RUN đọc từ đây (xem usage.service.ts).
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  await prisma.usageCounter.createMany({
    data: [
      { id: newId(), userId: demo.id, period, metric: 'DOCUMENTS_UPLOADED', value: documentCount },
      { id: newId(), userId: demo.id, period, metric: 'AI_JOBS_RUN', value: aiJobCount },
    ],
  });

  await prisma.auditLog.create({
    data: {
      id: newId(),
      actorId: demo.id,
      action: 'db.seed_demo_heavy',
      entityType: 'System',
      entityId: 'seed-demo-heavy-run',
      metadata: {
        at: new Date().toISOString(),
        courses: COURSES.length,
        submissions: submissionCount,
      },
    },
  });

  console.log('Seed dữ liệu lớn hoàn tất.');
  console.log(`  Khoá học: ${COURSES.length}`);
  console.log(`  Bài học: ${COURSES.reduce((s, c) => s + c.lessons.length, 0)}`);
  console.log(`  Lượt nộp bài: ${submissionCount}`);
  console.log(`  Bài đã hoàn thành: ${completedLessons}, đang học: ${inProgressLessons}`);
  console.log('  Gói: PRO');
  console.log('  Đăng nhập: demo@learn.ai / Demo@12345');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
