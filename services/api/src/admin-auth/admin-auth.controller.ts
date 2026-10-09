import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AdminUser } from '@prisma/client';
import { AdminLoginInput, adminLoginSchema } from '@ttp/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminAuthGuard, CurrentAdmin } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(adminLoginSchema)) body: AdminLoginInput) {
    return this.auth.login(body);
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  me(@CurrentAdmin() admin: AdminUser) {
    return { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  }
}
