import { Controller, Post, Get, Delete, Body, Param } from '@nestjs/common';
import { z } from 'zod';
import {
  uploadUrlSchema,
  confirmUploadSchema,
  importTextDocumentSchema,
  type ImportTextDocumentInput,
  type UploadUrlInput,
  type ConfirmUploadInput,
} from '@learn/contracts';
import { zodBody, zodParam } from '../../../core/exceptions/errors';
import { Auth, CurrentUser, type UserContext } from '../../../core/security';
import { DocumentsService } from '../application/documents.service';

const idSchema = z.string().uuid();

@Controller('api/v1')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('courses/:courseId/documents/upload-url')
  @Auth()
  async uploadUrl(
    @CurrentUser() user: UserContext,
    @Param('courseId', zodParam(idSchema)) courseId: string,
    @Body(zodBody(uploadUrlSchema)) body: UploadUrlInput,
  ) {
    return this.documents.requestUpload(user.userId, courseId, body);
  }

  @Post('courses/:courseId/documents/text')
  @Auth()
  async importText(
    @CurrentUser() user: UserContext,
    @Param('courseId', zodParam(idSchema)) courseId: string,
    @Body(zodBody(importTextDocumentSchema)) body: ImportTextDocumentInput,
  ) {
    return this.documents.importText(user.userId, courseId, body);
  }

  @Post('documents/:id/confirm')
  @Auth()
  async confirm(
    @CurrentUser() user: UserContext,
    @Param('id', zodParam(idSchema)) id: string,
    @Body(zodBody(confirmUploadSchema)) body: ConfirmUploadInput,
  ) {
    return this.documents.confirm(user.userId, id, body);
  }

  @Get('courses/:courseId/documents')
  @Auth()
  async list(
    @CurrentUser() user: UserContext,
    @Param('courseId', zodParam(idSchema)) courseId: string,
  ) {
    return this.documents.list(user.userId, courseId);
  }

  @Get('documents/:id/download')
  @Auth()
  async download(@CurrentUser() user: UserContext, @Param('id', zodParam(idSchema)) id: string) {
    return this.documents.getDownload(user.userId, id);
  }

  @Delete('documents/:id')
  @Auth()
  async remove(@CurrentUser() user: UserContext, @Param('id', zodParam(idSchema)) id: string) {
    return this.documents.remove(user.userId, id);
  }
}
