import { Injectable } from '@nestjs/common';
import type {
  ProgressOverview,
  ProgressCourse,
  HistoryPage,
  CourseProgress,
} from '@learn/contracts';
import { ApiError } from '../../../core/exceptions/errors';
import { env } from '../../../environment';
import { CourseRepository } from '../../courses/infrastructure/repositories/course.repository';
import { LessonRepository } from '../infrastructure/repositories/lesson.repository';
import { LearningProgressRepository } from '../infrastructure/repositories/learning-progress.repository';
import { SubmissionRepository } from '../infrastructure/repositories/submission.repository';

/**
 * Chuỗi ngày học liên tiếp chỉ cần nhìn lại tối đa ngần này ngày. Chuỗi dài hơn 1 năm
 * không phải thứ sản phẩm này hứa, và đây là cận trên cứng cho khối lượng dữ liệu đọc lên.
 */
const STREAK_LOOKBACK_DAYS = 366;

const DAY_MS = 86_400_000;

@Injectable()
export class ProgressService {
  constructor(
    private readonly courses: CourseRepository,
    private readonly lessons: LessonRepository,
    private readonly progress: LearningProgressRepository,
    private readonly submissions: SubmissionRepository,
  ) {}

  async overview(userId: string): Promise<ProgressOverview> {
    const [courseCount, totalLessons, completedLessons, scores, activeStreak] = await Promise.all([
      this.courses.countOwned(userId),
      this.lessons.countForOwner(userId),
      this.progress.countCompleted(userId),
      // score trong Submission là điểm % (0-100) đã chia tỷ lệ khi nộp bài (xem exercises.service).
      // Nhóm trong Postgres theo bài tập: làm lại để cải thiện điểm không được kéo điểm xuống.
      this.submissions.bestScoresForUser(userId),
      this.activeStreak(userId),
    ]);

    return {
      courseCount,
      totalLessons,
      completedLessons,
      averageScore: averageOfBestScores(scores),
      activeStreak,
    };
  }

  async perCourse(userId: string): Promise<{ courses: ProgressCourse[] }> {
    const courses = await this.courses.findManyWithLessonCount(userId);
    const rows = await this.progress.completedByCourse(userId);
    const doneMap = new Map(rows.map((r) => [r.courseId, r._count._all]));

    return {
      courses: courses.map((c) => {
        const total = c._count.lessons;
        const completed = doneMap.get(c.id) ?? 0;
        return {
          courseId: c.id,
          courseTitle: c.title,
          completed,
          total,
          // Khoá học chưa có bài học nào: 0/0 là 0%, không phải chia cho 0. Bản trước dùng
          // `Math.max(total, 1)` nên màn hình hiện "0/1" cho khoá học rỗng.
          percent: total === 0 ? 0 : Math.round((completed / total) * 100),
        };
      }),
    };
  }

  async history(userId: string, limit = 20, cursor?: string): Promise<HistoryPage> {
    // Lấy dư một dòng để biết còn trang sau hay không mà không cần COUNT.
    const rows = await this.submissions.page(userId, limit + 1, cursor);
    const hasMore = rows.length > limit;
    const subs = hasMore ? rows.slice(0, limit) : rows;
    return {
      nextCursor: hasMore ? (subs.at(-1)?.id ?? null) : null,
      items: subs.map((s) => ({
        id: s.id,
        courseId: s.exercise.lesson.course.id,
        lessonId: s.exercise.lesson.id,
        exerciseId: s.exerciseId,
        passed: s.score >= s.exercise.passScore,
        lessonTitle: s.exercise.lesson.title,
        courseTitle: s.exercise.lesson.course.title,
        exerciseTitle: s.exercise.title,
        score: s.score,
        maxScore: s.maxScore,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  async courseProgress(userId: string, courseId: string): Promise<CourseProgress> {
    const course = await this.courses.findOwned(courseId, userId);
    if (!course) throw ApiError.notFound('Không tìm thấy khóa học.');

    const [lessons, progress] = await Promise.all([
      this.lessons.listLightForCourse(course.id),
      this.progress.findForCourse(userId, course.id),
    ]);

    const map = new Map(progress.map((p) => [p.lessonId, p]));
    return {
      lessons: lessons.map((l) => {
        const p = map.get(l.id);
        return {
          lessonId: l.id,
          lessonTitle: l.title,
          orderIndex: l.orderIndex,
          status: p?.status ?? 'NOT_STARTED',
          bestScore: p?.bestScore ?? null,
        };
      }),
    };
  }

  /**
   * Số ngày học liên tiếp tính tới hôm nay (hoặc hôm qua, nếu hôm nay chưa học).
   *
   * Hai điều đáng chú ý:
   *
   * 1. Bản gốc dùng `findMany({ distinct: ['createdAt'] })`. `createdAt` là timestamp độ phân
   *    giải mili-giây nên gần như mọi dòng đều "distinct" — câu đó thực chất tải **toàn bộ**
   *    lượt nộp của người dùng về Node, không `take`, chỉ để rút ra một tập ngày. Nay gom ngày
   *    ngay trong Postgres và chặn cửa sổ nhìn lại.
   *
   * 2. Ngày cắt theo `APP_TIMEZONE` (mặc định `Asia/Ho_Chi_Minh`), không theo UTC. Cột
   *    `createdAt` là `TIMESTAMP(3)` **không** mang múi giờ và Prisma ghi giá trị UTC vào đó,
   *    nên phải nói rõ cả hai bước: `AT TIME ZONE 'UTC'` để gán ý nghĩa cho con số, rồi
   *    `AT TIME ZONE <tz>` để đổi sang giờ địa phương. Thiếu bước đầu thì kết quả phụ thuộc
   *    biến `TimeZone` của phiên Postgres — chạy máy khác ra số khác.
   */
  private async activeStreak(userId: string): Promise<number> {
    const tz = env.APP_TIMEZONE;
    const since = new Date(Date.now() - STREAK_LOOKBACK_DAYS * DAY_MS);
    const rows = await this.submissions.distinctStudyDays(userId, since, tz, STREAK_LOOKBACK_DAYS);
    if (rows.length === 0) return 0;

    // `date_trunc` trả `timestamp` không múi giờ, mang đúng ngày địa phương; Prisma dựng Date
    // coi nó là UTC, nên đọc lại bằng các getter UTC là ra đúng ngày ấy.
    const days = new Set(rows.map((r) => utcDayKey(r.day)));

    let cursor = localDayKey(new Date(), tz);
    // Chưa học hôm nay thì chuỗi vẫn còn sống nếu hôm qua có học.
    if (!days.has(cursor)) cursor = previousDayKey(cursor);
    if (!days.has(cursor)) return 0;

    let streak = 0;
    while (days.has(cursor)) {
      streak += 1;
      cursor = previousDayKey(cursor);
    }
    return streak;
  }
}

/** Ngày lịch của `d` tại `timeZone`, dạng `YYYY-MM-DD`. `en-CA` cho sẵn đúng định dạng đó. */
export function localDayKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Đọc ngày từ một Date mà các thành phần UTC của nó đã là ngày địa phương. */
export function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Lùi một ngày lịch. Làm trên chuỗi `YYYY-MM-DD` qua `Date.UTC` nên không dính giờ mùa hè:
 * ở múi giờ có DST, "24 tiếng trước" có thể vẫn là cùng ngày hoặc nhảy hai ngày.
 */
export function previousDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const prev = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  prev.setUTCDate(prev.getUTCDate() - 1);
  return utcDayKey(prev);
}

/** Trung bình lần tốt nhất của mỗi bài tập, làm tròn một chữ số thập phân. */
export function averageOfBestScores(
  rows: ReadonlyArray<{ _max: { score: number | null } }>,
): number | null {
  const scores = rows.flatMap((r) => (r._max.score === null ? [] : [r._max.score]));
  if (scores.length === 0) return null;
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.round(average * 10) / 10;
}
