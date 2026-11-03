import { Module, Global } from '@nestjs/common';
import { SecurityService, AuthGuard, RolesGuard, RateLimitGuard, AuditService } from './security';
import { AuditRepository } from '../infra/audit/audit.repository';

@Global()
@Module({
  providers: [
    SecurityService,
    AuthGuard,
    RolesGuard,
    RateLimitGuard,
    AuditService,
    AuditRepository,
  ],
  exports: [SecurityService, AuthGuard, RolesGuard, RateLimitGuard, AuditService, AuditRepository],
})
export class SecurityModule {}
