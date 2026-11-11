import { Controller, Get, Post, Body, Headers, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  dueReviewsQuerySchema,
  submitReviewSchema,
  type DueReviewsQuery,
  type SubmitReviewInput,
} from '@learn/contracts';
import { zodBody, zodParam } from '../../../core/exceptions/errors';
import { Auth, CurrentUser, type UserContext } from '../../../core/security';
import { parseIdempotencyKey } from '../application/review-idempotency';
import { ReviewsService } from '../application/reviews.service';

const idSchema = z.string().uuid();

@Controller('api/v1/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  // Đăng ký trước `:questionId` — "due" phải khớp route literal này, không bị nuốt bởi tham số động.
  @Get('due')
  @Auth()
  due(
    @CurrentUser() user: UserContext,
    @Query(zodBody(dueReviewsQuerySchema)) query: DueReviewsQuery,
  ) {
    return this.reviews.due(user.userId, query.limit);
  }

  @Post(':questionId')
  @Auth()
  review(
    @CurrentUser() user: UserContext,
    @Param('questionId', zodParam(idSchema)) questionId: string,
    @Body(zodBody(submitReviewSchema)) body: SubmitReviewInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.reviews.review(user.userId, questionId, body, parseIdempotencyKey(idempotencyKey));
  }
}
