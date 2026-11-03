import { Injectable } from '@nestjs/common';
import type { Prisma } from '@learn/db';
import type {
  ExerciseNavItem,
  ExerciseRead,
  SubmitExerciseInput,
  SubmissionResult,
} from '@learn/contracts';
import { ApiError } from '../../../core/exceptions/errors';
import { PrismaService } from '../../../infra/services';
import { ExerciseRepository } from '../infrastructure/repositories/exercise.repository';
import { SubmissionRepository } from '../infrastructure/repositories/submission.repository';
import { LearningProgressRepository } from '../infrastructure/repositories/learning-progress.repository';
import { LessonRepository } from '../infrastructure/repositories/lesson.repository';
import { isLessonComplete } from './lesson-completion';

export interface GradedAnswer {
  questionId: string;
  isCorrect: boolean;
  correctAnswer: unknown;
  explanation: string | null;
  pointsEarned: number;
}

export interface GradedResult {
  score: number;
  maxScore: number;
  passed: boolean;
  percent: number;
  results: GradedAnswer[];
}

type SubmittedAnswer = SubmitExerciseInput['answers'][number];

/** Điểm luôn quy về thang 100 khi lưu Submission — đọc ở progress/courses service. */
const SCORE_SCALE = 100;

/** Số lần thử lại khi hai lượt nộp song song giành cùng `attemptNo`. */
const ATTEMPT_CONFLICT_RETRIES = 3;

const isUniqueViolation = (e: unknown): boolean =>
  !!e && typeof e === 'object' && (e as { code?: unknown }).code === 'P2002';

@Injectable()
export class ExercisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lessons: LessonRepository,
    private readonly exercises: ExerciseRepository,
    private readonly submissions: SubmissionRepository,
    private readonly progress: LearningProgressRepository,
  ) {}

  /**
   * Một bài tập của bài học (mặc định bài đầu) + tổng quan mọi bài tập để điều hướng.
   * Trước đây chỉ đọc được bài đầu tiên: bài tập 2–5 AI sinh ra nằm chết trong DB.
   */
  async getExerciseRead(
    userId: string,
    lessonId: string,
    exerciseId?: string,
  ): Promise<ExerciseRead> {
    await this.assertLessonAccess(userId, lessonId);
    const exercise = await this.exercises.findForLesson(lessonId, exerciseId);
    if (!exercise) throw ApiError.notFound('Không có bài tập này trong bài học.');

    const [best, nav] = await Promise.all([
      this.submissions.findBest(userId, exercise.id),
      this.exerciseNav(userId, lessonId),
    ]);

    return {
      id: exercise.id,
      title: exercise.title,
      instruction: exercise.instruction,
      difficulty: exercise.difficulty as ExerciseRead['difficulty'],
      passScore: exercise.passScore,
      orderIndex: exercise.orderIndex,
      questions: exercise.questions.map((q) => ({
        id: q.id,
        orderIndex: q.orderIndex,
        type: q.type as ExerciseRead['questions'][number]['type'],
        prompt: q.prompt,
        points: q.points,
        // KHÔNG lộ isCorrect / correctAnswer trước khi nộp `[SPEC]`
        options: q.options.map((o) => ({
          id: o.id,
          orderIndex: o.orderIndex,
          label: o.label,
          content: o.content,
        })),
      })),
      bestSubmission: best
        ? {
            attemptNo: best.attemptNo,
            score: best.score,
            maxScore: best.maxScore,
            createdAt: best.createdAt.toISOString(),
          }
        : null,
      exercises: nav,
    };
  }

  private async exerciseNav(userId: string, lessonId: string): Promise<ExerciseNavItem[]> {
    const list = await this.exercises.listForLesson(lessonId);
    const best = await this.submissions.bestScoresForExercises(
      userId,
      list.map((e) => e.id),
    );
    return list.map((e) => {
      const bestScore = best.get(e.id) ?? null;
      return {
        id: e.id,
        title: e.title,
        orderIndex: e.orderIndex,
        difficulty: e.difficulty as ExerciseNavItem['difficulty'],
        questionCount: e._count.questions,
        passScore: e.passScore,
        bestScore,
        passed: bestScore !== null && bestScore >= e.passScore,
      };
    });
  }

  /** Chấm điểm ngay tại server, lưu 1 bản ghi, trả kết quả kèm đáp án — HANDBOOK §7.4. */
  async submit(
    userId: string,
    lessonId: string,
    input: SubmitExerciseInput,
  ): Promise<SubmissionResult> {
    const lesson = await this.assertLessonAccess(userId, lessonId);
    const exercise = await this.exercises.findForLesson(lessonId, input.exerciseId);
    if (!exercise) throw ApiError.notFound('Không có bài tập này trong bài học.');

    const questions = exercise.questions;
    // Chống gian lận: mọi questionId phải thuộc exercise này.
    const questionIds = new Set(questions.map((q) => q.id));
    for (const a of input.answers) {
      if (!questionIds.has(a.questionId)) throw ApiError.badRequest('Câu hỏi không thuộc bài tập.');
    }

    // Một Map dựng một lần, thay cho `input.answers.find()` lặp lại trong hai vòng lặp
    // riêng biệt (O(số câu hỏi × số đáp án) mỗi lượt nộp).
    const answerByQuestion = new Map<string, SubmittedAnswer>(
      input.answers.map((a) => [a.questionId, a]),
    );

    const { results, percent, passed } = gradeSubmission(questions, answerByQuestion, {
      passScore: exercise.passScore,
    });

    const created = await this.persistSubmission({
      userId,
      courseId: lesson.courseId,
      lessonId,
      exerciseId: exercise.id,
      percent,
      durationMs: input.durationMs ?? null,
      results,
      answerByQuestion,
    });

    return {
      id: created.id,
      exerciseId: exercise.id,
      lessonCompleted: created.lessonCompleted,
      attemptNo: created.attemptNo,
      score: percent,
      maxScore: SCORE_SCALE,
      passed,
      createdAt: created.createdAt.toISOString(),
      results,
    };
  }

  /**
   * Ghi Submission + SubmissionAnswer + LearningProgress trong MỘT transaction.
   *
   * Hai lỗi thật đã sửa ở đây:
   *
   * 1. `attemptNo` trước đây được tính bằng `aggregate(_max)` **ngoài** transaction rồi `+1`.
   *    Hai lượt nộp song song (bấm "Nộp bài" hai lần, hoặc tab đôi) đọc cùng một `_max` nên
   *    cùng chọn một `attemptNo`, đụng `@@unique([userId, exerciseId, attemptNo])`. Lỗi Prisma
   *    P2002 khi đó rơi vào nhánh fallback của error filter và trả **500** — người dùng mất
   *    bài làm. Nay tính trong transaction và thử lại khi đụng khoá: lượt thứ hai nhận
   *    `attemptNo` kế tiếp thay vì lỗi.
   *
   * 2. `upsertProgress()` nhận `tx` nhưng gọi `prisma.*` toàn cục, tức là **nằm ngoài**
   *    transaction. Transaction rollback (ví dụ một `submissionAnswer` lỗi) vẫn để lại
   *    LearningProgress đã ghi — bài học hiện "Hoàn thành" mà không có Submission nào.
   */
  private async persistSubmission(args: {
    userId: string;
    courseId: string;
    lessonId: string;
    exerciseId: string;
    percent: number;
    durationMs: number | null;
    results: GradedAnswer[];
    answerByQuestion: Map<string, SubmittedAnswer>;
  }): Promise<{ id: string; attemptNo: number; createdAt: Date; lessonCompleted: boolean }> {
    for (let retry = 0; ; retry++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const created = await this.submissions.createWithAnswers(tx, {
            userId: args.userId,
            exerciseId: args.exerciseId,
            percent: args.percent,
            maxScore: SCORE_SCALE,
            durationMs: args.durationMs,
            results: args.results.map((r) => ({
              questionId: r.questionId,
              rawAnswer: rawAnswerOf(args.answerByQuestion.get(r.questionId)),
              isCorrect: r.isCorrect,
              pointsEarned: r.pointsEarned,
              explanation: r.explanation,
            })),
          });

          // Luật hoàn thành tính SAU khi ghi lượt này, trong cùng transaction — điểm vừa nộp
          // phải được tính, và hai lượt nộp song song ở hai bài tập khác nhau không bỏ sót nhau.
          const siblings = await this.exercises.listForLesson(args.lessonId, tx);
          const best = await this.submissions.bestScoresForExercises(
            args.userId,
            siblings.map((e) => e.id),
            tx,
          );
          const lessonComplete = isLessonComplete(siblings, best);

          await this.progress.upsertAfterSubmission(tx, {
            userId: args.userId,
            courseId: args.courseId,
            lessonId: args.lessonId,
            percent: args.percent,
            lessonComplete,
          });

          return { ...created, lessonCompleted: lessonComplete };
        });
      } catch (e) {
        if (isUniqueViolation(e) && retry < ATTEMPT_CONFLICT_RETRIES) continue;
        throw e;
      }
    }
  }

  private async assertLessonAccess(userId: string, lessonId: string) {
    const lesson = await this.lessons.assertAccessible(lessonId, userId);
    if (!lesson) throw ApiError.notFound('Không tìm thấy bài học.');
    return lesson;
  }
}

/** Hình dạng `rawAnswer` lưu xuống DB, theo từng loại câu hỏi. */
function rawAnswerOf(answer: SubmittedAnswer | undefined): Prisma.InputJsonValue {
  if (!answer) return {};
  switch (answer.type) {
    case 'MULTIPLE_CHOICE':
      return { optionId: answer.optionId };
    case 'TRUE_FALSE':
      return { value: answer.value };
    default:
      return { text: 'text' in answer ? answer.text : '' };
  }
}

interface GradableQuestion {
  id: string;
  type: string;
  points: number;
  correctAnswer: unknown;
  explanation: string | null;
  options: Array<{ id: string; isCorrect: boolean }>;
}

/**
 * Chấm trọn một lượt nộp. Hàm thuần — không chạm DB nên unit-test được trực tiếp.
 * Câu không trả lời tính 0 điểm nhưng vẫn xuất hiện trong `results` kèm đáp án đúng.
 */
export function gradeSubmission(
  questions: GradableQuestion[],
  answerByQuestion: Map<string, SubmittedAnswer>,
  opts: { passScore: number },
): { results: GradedAnswer[]; percent: number; passed: boolean } {
  // `|| 1` chặn chia cho 0 khi bài tập không có câu hỏi nào có điểm.
  const maxPoints = questions.reduce((sum, q) => sum + q.points, 0) || 1;
  let pointsEarned = 0;

  const results: GradedAnswer[] = questions.map((q) => {
    const answer = answerByQuestion.get(q.id);
    const isCorrect = answer ? gradeAnswer(q, answer).isCorrect : false;
    if (isCorrect) pointsEarned += q.points;
    return {
      questionId: q.id,
      isCorrect,
      correctAnswer: publicCorrectAnswer(q),
      explanation: q.explanation,
      pointsEarned: isCorrect ? q.points : 0,
    };
  });

  const percent = Math.round((pointsEarned / maxPoints) * SCORE_SCALE);
  return { results, percent, passed: percent >= opts.passScore };
}

/**
 * Đáp án đúng gửi về client SAU khi nộp. Trắc nghiệm luôn là `{ optionId }` suy từ
 * `AnswerOption.isCorrect` — chính nguồn dùng để chấm. Cột `correctAnswer` của câu trắc nghiệm
 * không đáng tin: worker lưu `{ correctIndex }`, seed lưu `{ optionId }`, còn web chỉ đọc
 * `optionId`, nên trước đây bài AI sinh không bao giờ được chỉ ra đáp án đúng ở màn kết quả.
 */
function publicCorrectAnswer(q: GradableQuestion): unknown {
  if (q.type === 'MULTIPLE_CHOICE') {
    return { optionId: q.options.find((o) => o.isCorrect)?.id ?? null };
  }
  return q.correctAnswer;
}

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?)]+$/g, '');
}

/** Chấm điểm 1 câu hỏi dựa trên type — logic thuần để unit-test. `[SPEC]` HANDBOOK §7.4. */
export function gradeAnswer(
  q: {
    id: string;
    type: string;
    correctAnswer: unknown;
    options: Array<{ id: string; isCorrect: boolean }>;
  },
  answer: SubmittedAnswer,
): { isCorrect: boolean } {
  const correct = q.correctAnswer as { optionId?: string; value?: boolean; acceptable?: string[] };
  switch (q.type) {
    case 'MULTIPLE_CHOICE':
      if (answer.type !== 'MULTIPLE_CHOICE') return { isCorrect: false };
      return { isCorrect: q.options.some((o) => o.id === answer.optionId && o.isCorrect) };
    case 'TRUE_FALSE':
      if (answer.type !== 'TRUE_FALSE') return { isCorrect: false };
      return { isCorrect: correct.value === answer.value };
    case 'SHORT_ANSWER':
    case 'FILL_BLANK':
      if (answer.type !== 'SHORT_ANSWER' && answer.type !== 'FILL_BLANK')
        return { isCorrect: false };
      return {
        isCorrect: (correct.acceptable ?? []).map(normalize).includes(normalize(answer.text)),
      };
    default:
      return { isCorrect: false };
  }
}
