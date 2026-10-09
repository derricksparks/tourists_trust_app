import {
  BadRequestException,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Post,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  Body,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Account, AccountRole, Dmc, Operator } from '@prisma/client';
import { AdminLoginInput, PortalLoginResult, PortalProfile, portalLoginSchema, setPasswordSchema } from '@ttp/shared-types';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

export type PortalAccount = Account & { operator: Operator | null; dmc: Dmc | null };
type PortalRequest = Request & { account?: PortalAccount };

const ACCOUNT_TOKEN_TTL = '12h';
const SET_PASSWORD_TTL = '7d';
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

/** Ties a set-password link to the current password hash, so the link dies once it is used. */
const fingerprint = (passwordHash: string) => createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
const portalUrl = () => (process.env.PORTAL_URL ?? 'http://localhost:5174').replace(/\/$/, '');

/** A hash nobody can log in with; used until the person sets their own password from the link. */
export const unusablePasswordHash = () => bcrypt.hashSync(randomBytes(32).toString('hex'), 10);

export function toProfile(a: PortalAccount): PortalProfile {
  return {
    id: a.id,
    email: a.email,
    role: a.role,
    operator: a.operator && { id: a.operator.id, name: a.operator.name, slug: a.operator.slug, status: a.operator.status },
    dmc: a.dmc && { id: a.dmc.id, name: a.dmc.name, status: a.dmc.status },
  };
}

@Injectable()
export class PortalAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login({ email, password }: AdminLoginInput): Promise<PortalLoginResult> {
    const account = await this.prisma.account.findUnique({ where: { email }, include: { operator: true, dmc: true } });
    const ok = await bcrypt.compare(password, account?.passwordHash ?? DUMMY_HASH);
    if (!account || !ok || !account.active) throw new UnauthorizedException('Invalid email or password');
    await this.prisma.account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    return { accessToken: await this.jwt.signAsync({ sub: account.id, typ: 'account' }, { expiresIn: ACCOUNT_TOKEN_TTL }), account: toProfile(account) };
  }

  /** One-time link for a new partner (or a reset). Valid 7 days, and only until the password changes. */
  async setPasswordLink(account: Account): Promise<string> {
    const token = await this.jwt.signAsync({ sub: account.id, typ: 'pwset', fp: fingerprint(account.passwordHash) }, { expiresIn: SET_PASSWORD_TTL });
    return `${portalUrl()}/set-password?token=${token}`;
  }

  async setPassword(token: string, password: string): Promise<PortalLoginResult> {
    let payload: { sub: string; typ: string; fp: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new BadRequestException('This link has expired. Ask us for a new one.');
    }
    const account = payload.typ === 'pwset' ? await this.prisma.account.findUnique({ where: { id: payload.sub } }) : null;
    if (!account || !account.active || fingerprint(account.passwordHash) !== payload.fp) {
      throw new BadRequestException('This link has already been used or is no longer valid.');
    }
    await this.prisma.account.update({ where: { id: account.id }, data: { passwordHash: await bcrypt.hash(password, 12) } });
    return this.login({ email: account.email, password });
  }
}

const ROLES_KEY = 'portalRoles';
export const PortalRoles = (...roles: AccountRole[]) => SetMetadata(ROLES_KEY, roles);
export const CurrentAccount = createParamDecorator((_: unknown, ctx: ExecutionContext): PortalAccount => ctx.switchToHttp().getRequest<PortalRequest>().account!);

/**
 * Partner (operator / DMC) bearer token. Reloads the account each request so deactivation is
 * immediate. Business rules about the company's own status (e.g. a DMC must be approved to see
 * inventory) are checked by the controllers, so a pending company can still log in and see why.
 */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PortalRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();
    let payload: { sub: string; typ: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (payload.typ !== 'account') throw new UnauthorizedException();
    const account = await this.prisma.account.findUnique({ where: { id: payload.sub }, include: { operator: true, dmc: true } });
    if (!account || !account.active) throw new UnauthorizedException();
    const roles = this.reflector.getAllAndOverride<AccountRole[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles && !roles.includes(account.role)) throw new ForbiddenException();
    req.account = account;
    return true;
  }
}

@Controller('portal/auth')
export class PortalAuthController {
  constructor(private readonly auth: PortalAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(portalLoginSchema)) body: AdminLoginInput) {
    return this.auth.login(body);
  }

  @Post('set-password')
  @HttpCode(200)
  setPassword(@Body(new ZodValidationPipe(setPasswordSchema)) body: z.infer<typeof setPasswordSchema>) {
    return this.auth.setPassword(body.token, body.password);
  }

  @Get('me')
  @UseGuards(PortalAuthGuard)
  me(@CurrentAccount() account: PortalAccount) {
    return toProfile(account);
  }
}
