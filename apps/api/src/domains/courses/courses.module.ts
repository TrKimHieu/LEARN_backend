import { Module } from '@nestjs/common';
import { CoursesController } from './presentation/courses.controller';
import { CoursesService } from './application/courses.service';
import { CourseRepository } from './infrastructure/repositories/course.repository';
import { SubscriptionsModule } from '../../domains/subscriptions/subscriptions.module';

@Module({
  imports: [SubscriptionsModule],
  controllers: [CoursesController],
  providers: [CoursesService, CourseRepository],
  exports: [CoursesService, CourseRepository],
})
export class CoursesModule {}
