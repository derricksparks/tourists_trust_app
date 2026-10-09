import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AdminOverviewModule } from './admin-overview/admin-overview.module';
import { PrismaModule } from './common/prisma.module';
import { RevalidationModule } from './common/revalidation.service';
import { ContentModule } from './content/content.module';
import { InquiriesModule } from './inquiries/inquiries.module';
import { InsurersModule } from './insurers/insurers.module';
import { ReviewInvitesModule } from './review-invites/review-invites.module';
import { PortalModule } from './portal/portal.module';
import { ScoringModule } from './scoring/scoring.service';
import { TranslatorsModule } from './translators/translators.module';
import { PublicModule } from './public/public.module';
import { TelegramModule } from './telegram/telegram.module';
import { FeedModule } from './feed/feed.module';
import { HealthController } from './health/health.controller';
import { NotificationsModule } from './mail/notifications.service';
import { StorageModule } from './storage/document-store';
import { OperatorsModule } from './operators/operators.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    PrismaModule,
    RevalidationModule,
    NotificationsModule,
    StorageModule,
    AdminAuthModule,
    AdminOverviewModule,
    OperatorsModule,
    ReviewsModule,
    InquiriesModule,
    ContentModule,
    PublicModule,
    TelegramModule,
    TranslatorsModule,
    InsurersModule,
    ReviewInvitesModule,
    ScoringModule,
    PortalModule,
    FeedModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
