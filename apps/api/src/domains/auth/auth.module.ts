import { Module } from '@nestjs/common';
import { AuthController } from './presentation/auth.controller';
import { AuthService } from './application/auth.service';
import { UserRepository } from './infrastructure/repositories/user.repository';
import { RefreshTokenRepository } from './infrastructure/repositories/refresh-token.repository';
import { PasswordResetRepository } from './infrastructure/repositories/password-reset.repository';
import { MailService } from '../../infra/mail/mail.service';
import { SubscriptionsModule } from '../../domains/subscriptions/subscriptions.module';

@Module({
  imports: [SubscriptionsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    UserRepository,
    RefreshTokenRepository,
    PasswordResetRepository,
    MailService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
