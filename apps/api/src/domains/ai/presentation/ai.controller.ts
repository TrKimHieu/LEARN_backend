import { Controller, Post, Get, Body, Param, Query, Res, Req, Header } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { generateLessonsSchema, type GenerateLessonsInput } from '@learn/contracts';
import { zodBody, zodParam, ApiError } from '../../../core/exceptions/errors';
import { Auth, CurrentUser, type UserContext } from '../../../core/security';
import { AiService } from '../application/ai.service';
import { RedisService } from '../../../infra/services';

const idSchema = z.string().uuid();

@Controller('api/v1/ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly redis: RedisService,
  ) {}

  @Post('courses/:courseId/generate-lessons')
  @Auth()
  async generateLessons(
    @CurrentUser() user: UserContext,
    @Param('courseId', zodParam(idSchema)) courseId: string,
    // Phải bọc `zodBody()`: truyền thẳng schema Zod làm pipe thì Nest gọi `schema.transform(body)`
    // — hàm TẠO schema mới của Zod, không phải kiểm tra — nên body thành một object schema và
    // mọi tham số (documentIds, language, difficulty) bị bỏ qua âm thầm.
    @Body(zodBody(generateLessonsSchema)) body: GenerateLessonsInput,
  ) {
    return this.ai.generateLessons(user.userId, courseId, body);
  }

  @Get('jobs')
  @Auth()
  async jobs(@CurrentUser() user: UserContext, @Query('courseId') courseId?: string) {
    if (courseId && !idSchema.safeParse(courseId).success)
      throw ApiError.badRequest('Tham số không hợp lệ.');
    return this.ai.listJobs(user.userId, courseId);
  }

  @Get('jobs/:id')
  @Auth()
  async job(@CurrentUser() user: UserContext, @Param('id', zodParam(idSchema)) id: string) {
    return this.ai.getJob(user.userId, id);
  }

  @Post('jobs/:id/cancel')
  @Auth()
  async cancel(@CurrentUser() user: UserContext, @Param('id', zodParam(idSchema)) id: string) {
    return this.ai.cancelJob(user.userId, id);
  }

  @Get('jobs/:id/stream')
  @Auth()
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  async stream(
    @CurrentUser() user: UserContext,
    @Param('id', zodParam(idSchema)) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Chỉ chủ sở hữu job mới nhận stream.
    const job = await this.ai.getJob(user.userId, id);
    res.flushHeaders?.();
    res.write(
      `data: ${JSON.stringify({ jobId: id, status: job.status, progress: job.progress, label: job.progressLabel })}\n\n`,
    );

    const channel = `job:${id}`;
    await this.redis.subscribe(channel, (payload) => {
      res.write(`data: ${payload}\n\n`);
      try {
        const ev = JSON.parse(payload) as { status?: string };
        if (ev.status === 'SUCCEEDED' || ev.status === 'FAILED' || ev.status === 'CANCELLED') {
          res.end();
          void this.redis.unsubscribe(channel);
        }
      } catch {
        /* bỏ qua event không parse được */
      }
    });

    const heartbeat = setInterval(() => {
      res.write(': hb\n\n');
    }, 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      void this.redis.unsubscribe(channel);
    });
  }
}
