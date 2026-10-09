import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminLoginInput, AdminLoginResult } from '@ttp/shared-types';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma.service';

export interface AdminJwtPayload {
  sub: string;
  typ: 'admin';
}

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login({ email, password }: AdminLoginInput): Promise<AdminLoginResult> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
    if (!admin || !ok || !admin.active) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const payload: AdminJwtPayload = { sub: admin.id, typ: 'admin' };
    return {
      accessToken: await this.jwt.signAsync(payload),
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    };
  }
}
