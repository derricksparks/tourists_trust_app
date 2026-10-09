import { Global, Module } from '@nestjs/common';
import { AdminB2bModule } from './admin-b2b.module';
import { DmcPortalModule } from './dmc-portal.module';
import { OnboardingModule } from './onboarding.module';
import { OperatorPortalModule } from './operator-portal.module';
import { PortalAuthController, PortalAuthGuard, PortalAuthService } from './portal-auth';

@Global()
@Module({
  controllers: [PortalAuthController],
  providers: [PortalAuthService, PortalAuthGuard],
  exports: [PortalAuthService, PortalAuthGuard],
})
export class PortalAuthModule {}

/** Partner portal (operators, DMCs; Phase 3), operator self-onboarding (Phase 4) and the staff tools behind them. */
@Module({ imports: [PortalAuthModule, OperatorPortalModule, DmcPortalModule, AdminB2bModule, OnboardingModule] })
export class PortalModule {}
