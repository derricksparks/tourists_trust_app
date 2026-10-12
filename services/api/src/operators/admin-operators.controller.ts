import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AdminUser } from '@prisma/client';
import {
  OperatorCreateInput,
  OperatorDecisionInput,
  OperatorListQuery,
  OperatorUpdateInput,
  NotificationChannelInput,
  notificationChannelSchema,
  operatorCreateSchema,
  operatorDecisionSchema,
  operatorListQuerySchema,
  operatorUpdateSchema,
} from '@ttp/shared-types';
import { AdminAuthGuard, AdminRoles, CurrentAdmin } from '../admin-auth/admin-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OperatorsService } from './operators.service';

/** Operator approval queue and manual operator entry (Phase 0). */
@Controller('admin/operators')
@UseGuards(AdminAuthGuard)
export class AdminOperatorsController {
  constructor(private readonly operators: OperatorsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(operatorListQuerySchema)) query: OperatorListQuery) {
    return this.operators.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.operators.get(id);
  }

  @Post()
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  create(
    @Body(new ZodValidationPipe(operatorCreateSchema)) body: OperatorCreateInput,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.operators.create(body, admin);
  }

  @Patch(':id')
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(operatorUpdateSchema)) body: OperatorUpdateInput,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.operators.update(id, body, admin);
  }

  /** How the operator is notified (pilot round). Staff set it when an operator asks by phone. */
  @Put(':id/notification-channel')
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  notificationChannel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(notificationChannelSchema)) body: NotificationChannelInput,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.operators.setNotificationChannel(id, body.preferredChannel, { actorAdminId: admin.id });
  }

  @Post(':id/decision')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(operatorDecisionSchema)) body: OperatorDecisionInput,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.operators.decide(id, body, admin);
  }
}
