import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AdminOverviewModule } from './admin-overview/admin-overview.module';
import { PrismaModule } from './common/prisma.module';
import { HealthController } from './health/health.controller';
import { OperatorsModule } from './operators/operators.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [PrismaModule, AdminAuthModule, AdminOverviewModule, OperatorsModule, ReviewsModule],
  controllers: [HealthController],
})
export class AppModule {}
