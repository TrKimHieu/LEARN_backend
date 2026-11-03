import { Module } from '@nestjs/common';
import { DocumentsController } from './presentation/documents.controller';
import { DocumentsService } from './application/documents.service';
import { DocumentRepository } from './infrastructure/repositories/document.repository';
import { SubscriptionsModule } from '../../domains/subscriptions/subscriptions.module';
import { CoursesModule } from '../courses/courses.module';

@Module({
  imports: [SubscriptionsModule, CoursesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentRepository],
  exports: [DocumentsService, DocumentRepository],
})
export class DocumentsModule {}
