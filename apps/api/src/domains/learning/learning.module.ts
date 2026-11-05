import { Module } from '@nestjs/common';
import { LearningController } from './presentation/learning.controller';
import { LessonsService } from './application/lessons.service';
import { ExercisesService } from './application/exercises.service';
import { ProgressService } from './application/progress.service';
import { LessonRepository } from './infrastructure/repositories/lesson.repository';
import { LearningProgressRepository } from './infrastructure/repositories/learning-progress.repository';
import { ExerciseRepository } from './infrastructure/repositories/exercise.repository';
import { SubmissionRepository } from './infrastructure/repositories/submission.repository';
import { ShortAnswerGrader } from './infrastructure/short-answer-grader';
import { CoursesModule } from '../../domains/courses/courses.module';

@Module({
  imports: [CoursesModule],
  controllers: [LearningController],
  providers: [
    LessonsService,
    ExercisesService,
    ProgressService,
    LessonRepository,
    LearningProgressRepository,
    ExerciseRepository,
    SubmissionRepository,
    ShortAnswerGrader,
  ],
  exports: [LessonsService, ExercisesService],
})
export class LearningModule {}
