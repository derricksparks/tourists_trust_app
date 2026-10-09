import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { PrismaModule } from './common/prisma.module';
import { HealthController } from './health/health.controller';
import { OperatorsModule } from './operators/operators.module';

@Module({
  imports: [PrismaModule, AdminAuthModule, OperatorsModule],
  controllers: [HealthController],
})
export class AppModule {}
