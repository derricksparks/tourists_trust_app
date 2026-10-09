import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AdminUser } from '@prisma/client';
import { ReviewDecisionInput, ReviewListQuery, reviewDecisionSchema, reviewListQuerySchema } from '@ttp/shared-types';
import { AdminAuthGuard, AdminRoles, CurrentAdmin } from '../admin-auth/admin-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReviewsService } from './reviews.service';

@Controller('admin/reviews')
@UseGuards(AdminAuthGuard)
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(reviewListQuerySchema)) query: ReviewListQuery) {
    return this.reviews.list(query);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionInput,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.reviews.decide(id, body, admin);
  }
}

@Module({ controllers: [AdminReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}
