import { Module } from '@nestjs/common';
import { CommonModule } from './infra/services';
import { SecurityModule } from './core/security.module';
import { HealthModule } from './modules/health/health.module';
import { MetaModule } from './modules/meta/meta.module';
import { AuthModule } from './domains/auth/auth.module';
import { CoursesModule } from './domains/courses/courses.module';
import { DocumentsModule } from './domains/documents/documents.module';
import { LearningModule } from './domains/learning/learning.module';
import { SubscriptionsModule } from './domains/subscriptions/subscriptions.module';
import { AiModule } from './domains/ai/ai.module';
import { AdminModule } from './domains/admin/admin.module';

@Module({
  imports: [
    CommonModule,
    SecurityModule,
    HealthModule,
    MetaModule,
    AuthModule,
    CoursesModule,
    DocumentsModule,
    LearningModule,
    SubscriptionsModule,
    AiModule,
    AdminModule,
  ],
})
export class AppModule {}
