import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AdminRole, AdminUser } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../common/prisma.service';
import { AdminJwtPayload } from './admin-auth.service';

const ROLES_KEY = 'adminRoles';

/** Restricts a route to the given admin roles. Without it, any active admin may call the route. */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

type AdminRequest = Request & { admin?: AdminUser };

/** The authenticated admin, set by AdminAuthGuard. */
export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminUser => ctx.switchToHttp().getRequest<AdminRequest>().admin!,
);

/**
 * Verifies the admin bearer token and reloads the admin on every request, so a deactivated
 * account or a role change takes effect immediately rather than when the token expires.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    let payload: AdminJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminJwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (payload.typ !== 'admin') throw new UnauthorizedException();

    const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.active) throw new UnauthorizedException();

    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles && !roles.includes(admin.role)) throw new ForbiddenException();

    req.admin = admin;
    return true;
  }
}
