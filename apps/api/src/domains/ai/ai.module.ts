import { Module } from '@nestjs/common';
import { AiController } from './presentation/ai.controller';
import { AiService } from './application/ai.service';
import { AIJobRepository } from './infrastructure/repositories/ai-job.repository';
import { GenerationRunRepository } from './infrastructure/repositories/generation-run.repository';
import { SubscriptionsModule } from '../../domains/subscriptions/subscriptions.module';
import { CoursesModule } from '../../domains/courses/courses.module';
import { DocumentsModule } from '../../domains/documents/documents.module';

@Module({
  imports: [SubscriptionsModule, CoursesModule, DocumentsModule],
  controllers: [AiController],
  providers: [AiService, AIJobRepository, GenerationRunRepository],
  exports: [AiService],
})
export class AiModule {}
