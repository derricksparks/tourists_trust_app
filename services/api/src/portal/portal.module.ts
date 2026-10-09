import { Global, Module } from '@nestjs/common';
import { AdminB2bModule } from './admin-b2b.module';
import { DmcPortalModule } from './dmc-portal.module';
import { OperatorPortalModule } from './operator-portal.module';
import { PortalAuthController, PortalAuthGuard, PortalAuthService } from './portal-auth';

@Global()
@Module({
  controllers: [PortalAuthController],
  providers: [PortalAuthService, PortalAuthGuard],
  exports: [PortalAuthService, PortalAuthGuard],
})
export class PortalAuthModule {}

/** Phase 3: partner portal (operators, DMCs) and the staff tools behind it. */
@Module({ imports: [PortalAuthModule, OperatorPortalModule, DmcPortalModule, AdminB2bModule] })
export class PortalModule {}
