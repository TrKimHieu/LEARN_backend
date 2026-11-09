import { Controller, Get, Patch, Post, Delete, Body, Headers, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  patchLessonSchema,
  reorderLessonsSchema,
  submitExerciseSchema,
  type PatchLessonInput,
  type ReorderLessonsInput,
  type SubmitExerciseInput,
} from '@learn/contracts';
import { zodBody, zodParam } from '../../../core/exceptions/errors';
import { Auth, CurrentUser, type UserContext } from '../../../core/security';
import { LessonsService } from '../application/lessons.service';
import { ExercisesService } from '../application/exercises.service';
import { parseIdempotencyKey } from '../application/submit-idempotency';
import { ProgressService } from '../application/progress.service';

const idSchema = z.string().uuid();
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

@Controller('api/v1')
export class LearningController {
  constructor(
    private readonly lessons: LessonsService,
    private readonly exercises: ExercisesService,
    private readonly progress: ProgressService,
  ) {}

  @Get('courses/:courseId/lessons')
  @Auth()
  async listLessons(
    @CurrentUser() user: UserContext,
    @Param('courseId', zodParam(idSchema)) courseId: string,
  ) {
    return this.lessons.listSummaries(user.userId, courseId);
  }

  @Get('courses/:courseId/lessons/:lessonId')
  @Auth()
  async lessonRead(
    @CurrentUser() user: UserContext,
    @Param('courseId', zodParam(idSchema)) courseId: string,
    @Param('lessonId', zodParam(idSchema)) lessonId: string,
  ) {
    return this.lessons.getLessonRead(user.userId, courseId, lessonId);
  }

  @Get('courses/:courseId/lessons/:lessonId/sources')
  @Auth()
  async lessonSources(
    @CurrentUser() user: UserContext,
    @Param('courseId', zodParam(idSchema)) courseId: string,
    @Param('lessonId', zodParam(idSchema)) lessonId: string,
  ) {
    return this.lessons.getLessonSources(user.userId, courseId, lessonId);
  }

  @Post('courses/:courseId/lessons/:lessonId/start')
  @Auth()
  async startLesson(
    @CurrentUser() user: UserContext,
    @Param('courseId', zodParam(idSchema)) courseId: string,
    @Param('lessonId', zodParam(idSchema)) lessonId: string,
  ) {
    return this.lessons.startLesson(user.userId, courseId, lessonId);
  }

  // Đăng ký trước route `:lessonId` bên dưới — "reorder" phải khớp route literal này trước,
  // không bị nuốt bởi tham số động `:lessonId`.
  @Patch('courses/:courseId/lessons/reorder')
  @Auth()
  async reorderLessons(
    @CurrentUser() user: UserContext,
    @Param('courseId', zodParam(idSchema)) courseId: string,
    @Body(zodBody(reorderLessonsSchema)) body: ReorderLessonsInput,
  ) {
    return this.lessons.reorderLessons(user.userId, courseId, body);
  }

  @Patch('courses/:courseId/lessons/:lessonId')
  @Auth()
  async patchLesson(
    @CurrentUser() user: UserContext,
    @Param('courseId', zodParam(idSchema)) courseId: string,
    @Param('lessonId', zodParam(idSchema)) lessonId: string,
    @Body(zodBody(patchLessonSchema)) body: PatchLessonInput,
  ) {
    return this.lessons.patchLesson(user.userId, courseId, lessonId, body);
  }

  @Delete('courses/:courseId/lessons/:lessonId')
  @Auth()
  async deleteLesson(
    @CurrentUser() user: UserContext,
    @Param('courseId', zodParam(idSchema)) courseId: string,
    @Param('lessonId', zodParam(idSchema)) lessonId: string,
  ) {
    return this.lessons.deleteLesson(user.userId, courseId, lessonId);
  }

  @Get('lessons/:lessonId/exercise')
  @Auth()
  async exerciseRead(
    @CurrentUser() user: UserContext,
    @Param('lessonId', zodParam(idSchema)) lessonId: string,
    @Query('exerciseId', zodParam(idSchema.optional())) exerciseId: string | undefined,
  ) {
    return this.exercises.getExerciseRead(user.userId, lessonId, exerciseId);
  }

  @Post('lessons/:lessonId/exercise/submit')
  @Auth()
  async submit(
    @CurrentUser() user: UserContext,
    @Param('lessonId', zodParam(idSchema)) lessonId: string,
    @Body(zodBody(submitExerciseSchema)) body: SubmitExerciseInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.exercises.submit(user.userId, lessonId, body, parseIdempotencyKey(idempotencyKey));
  }

  @Get('progress/overview')
  @Auth()
  overview(@CurrentUser() user: UserContext) {
    return this.progress.overview(user.userId);
  }

  @Get('progress/courses')
  @Auth()
  perCourse(@CurrentUser() user: UserContext) {
    return this.progress.perCourse(user.userId);
  }

  @Get('progress/course/:courseId')
  @Auth()
  async courseProgress(
    @CurrentUser() user: UserContext,
    @Param('courseId', zodParam(idSchema)) courseId: string,
  ) {
    return this.progress.courseProgress(user.userId, courseId);
  }

  @Get('progress/history')
  @Auth()
  async history(
    @CurrentUser() user: UserContext,
    @Query('limit', zodParam(limitSchema)) limit: number,
    @Query('cursor', zodParam(idSchema.optional())) cursor: string | undefined,
  ) {
    return this.progress.history(user.userId, limit, cursor);
  }
}
