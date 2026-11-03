import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { z } from 'zod';
import {
  createCourseSchema,
  patchCourseSchema,
  type CreateCourseInput,
  type PatchCourseInput,
} from '@learn/contracts';
import { zodBody, zodParam } from '../../../core/exceptions/errors';
import { Auth, CurrentUser, type UserContext } from '../../../core/security';
import { CoursesService } from '../application/courses.service';

const idSchema = z.string().uuid();

@Controller('api/v1')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get('workspace')
  @Auth()
  async workspace(@CurrentUser() user: UserContext) {
    return this.courses.listForOwner(user.userId);
  }

  @Post('courses')
  @Auth()
  async create(
    @CurrentUser() user: UserContext,
    @Body(zodBody(createCourseSchema)) body: CreateCourseInput,
  ) {
    return this.courses.create(user.userId, body);
  }

  @Get('courses/:id')
  @Auth()
  async detail(@CurrentUser() user: UserContext, @Param('id', zodParam(idSchema)) id: string) {
    return this.courses.getDetail(user.userId, id);
  }

  @Patch('courses/:id')
  @Auth()
  async patch(
    @CurrentUser() user: UserContext,
    @Param('id', zodParam(idSchema)) id: string,
    @Body(zodBody(patchCourseSchema)) body: PatchCourseInput,
  ) {
    return this.courses.patch(user.userId, id, body);
  }

  @Delete('courses/:id')
  @Auth()
  async remove(@CurrentUser() user: UserContext, @Param('id', zodParam(idSchema)) id: string) {
    return this.courses.remove(user.userId, id);
  }
}
