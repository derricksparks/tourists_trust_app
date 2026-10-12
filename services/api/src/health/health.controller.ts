import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const startedAt = new Date();

/**
 * Health and uptime, for the Docker health check and an external uptime monitor
 * (https://admin.<domain>/api/health). 200 when the API can reach the database, 503 when it can't.
 * Shows nothing private.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const t0 = Date.now();
    let database: { ok: boolean; latencyMs?: number; error?: string };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = { ok: true, latencyMs: Date.now() - t0 };
    } catch {
      database = { ok: false, error: 'database unreachable' };
    }
    const body = {
      status: database.ok ? 'ok' : 'error',
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: startedAt.toISOString(),
      time: new Date().toISOString(),
      version: process.env.APP_VERSION ?? null,
      checks: { database },
    };
    if (!database.ok) throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
