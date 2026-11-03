import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ApiError } from '../../../core/exceptions/errors';
import { Admin, AdminContext } from './admin.decorators';
import { AdminService } from '../application/admin.service';

@Controller('api/v1/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('metrics')
  @Admin()
  async metrics(@AdminContext() admin: AdminContext) {
    void admin;
    return this.admin.metrics();
  }

  @Get('users')
  @Admin()
  async users(@Query('q') q?: string) {
    return this.admin.users(q);
  }

  @Get('courses')
  @Admin()
  async courses(@Query('q') q?: string) {
    return this.admin.courses(q);
  }

  @Get('subscriptions')
  @Admin()
  async subscriptions() {
    return this.admin.subscriptions();
  }

  @Get('ai-jobs')
  @Admin()
  async aiJobs(@Query('status') status?: string) {
    return this.admin.aiJobs(status);
  }

  @Get('ai-jobs/:id')
  @Admin()
  async aiJobDetail(@Param('id') id: string) {
    if (!id.trim()) throw ApiError.badRequest('Thiếu id job.');
    return this.admin.aiJobDetail(id);
  }

  @Post('ai-jobs/:id/retry')
  @Admin()
  async retryAiJob(@Param('id') id: string, @AdminContext() admin: AdminContext) {
    return this.admin.retryAiJob(id, admin);
  }

  @Get('ai-jobs/:id/audit-log')
  @Admin()
  async aiJobAuditLog(@Param('id') id: string) {
    return this.admin.aiJobAuditLog(id);
  }
}
