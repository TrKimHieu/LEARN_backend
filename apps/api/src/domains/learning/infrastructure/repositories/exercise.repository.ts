import { Injectable } from '@nestjs/common';
import { PrismaService, type Db } from '../../../../infra/services';

@Injectable()
export class ExerciseRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Một bài tập của bài học kèm câu hỏi/đáp án — `exerciseId` bỏ trống thì lấy bài đầu tiên
   * (theo orderIndex). Lọc cả `lessonId` khi có `exerciseId`: id bài tập từ client không được
   * dùng để với sang bài tập của bài học khác. Bản trả ra client KHÔNG lộ isCorrect /
   * correctAnswer trước khi nộp `[SPEC]` — việc lọc đó nằm ở service.
   */
  findForLesson(lessonId: string, exerciseId?: string, db: Db = this.prisma.client) {
    return db.exercise.findFirst({
      where: { lessonId, ...(exerciseId ? { id: exerciseId } : {}) },
      orderBy: { orderIndex: 'asc' },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { options: { orderBy: { orderIndex: 'asc' } } },
        },
      },
    });
  }

  /** Mọi bài tập của một bài học — tổng quan cho điều hướng và luật hoàn thành bài học. */
  listForLesson(lessonId: string, db: Db = this.prisma.client) {
    return db.exercise.findMany({
      where: { lessonId },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        title: true,
        orderIndex: true,
        difficulty: true,
        passScore: true,
        _count: { select: { questions: true } },
      },
    });
  }

  /**
   * Số bài tập theo từng bài học — thay cho N câu COUNT khi liệt kê bài học.
   */
  countByLesson(courseId: string, db: Db = this.prisma.client) {
    return db.exercise.groupBy({
      by: ['lessonId'],
      where: { lesson: { courseId } },
      _count: true,
    });
  }
}
