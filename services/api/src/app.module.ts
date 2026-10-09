import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AdminOverviewModule } from './admin-overview/admin-overview.module';
import { PrismaModule } from './common/prisma.module';
import { RevalidationModule } from './common/revalidation.service';
import { ContentModule } from './content/content.module';
import { InquiriesModule } from './inquiries/inquiries.module';
import { PublicModule } from './public/public.module';
import { TelegramModule } from './telegram/telegram.module';
import { HealthController } from './health/health.controller';
import { OperatorsModule } from './operators/operators.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    PrismaModule,
    RevalidationModule,
    AdminAuthModule,
    AdminOverviewModule,
    OperatorsModule,
    ReviewsModule,
    InquiriesModule,
    ContentModule,
    PublicModule,
    TelegramModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
