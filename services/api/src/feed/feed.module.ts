import {
  BadRequestException,
  Body,
  CanActivate,
  ConflictException,
  Controller,
  createParamDecorator,
  Delete,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Operator, PackageStatus, Prisma } from '@prisma/client';
import { FeedPackageInput, ImportResult, apiKeyCreateSchema, csvImportSchema, externalRefSchema, feedPackageSchema } from '@ttp/shared-types';
import { createHash, randomBytes } from 'crypto';
import { Request } from 'express';
import { z } from 'zod';
import { activeCountry } from '../common/countries';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limit';
import { RevalidationService } from '../common/revalidation.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { packageData, uniquePackageSlug } from '../portal/packages';
import { CurrentAccount, PortalAccount, PortalAuthGuard, PortalRoles } from '../portal/portal-auth';
import { ScoringService } from '../scoring/scoring.service';
import { rowsFromCsv } from './csv';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const MAX_ACTIVE_KEYS = 5;
/** Statuses that may send tours at all (drafts are allowed before approval, decision 2026-10-10). */
const CAN_FEED = ['DRAFT', 'PENDING', 'FLAGGED', 'APPROVED'];

const feedInclude = { dateRanges: { orderBy: { startDate: 'asc' } } } satisfies Prisma.PackageInclude;
type FeedPackage = Prisma.PackageGetPayload<{ include: typeof feedInclude }>;

/** What the feed returns for a tour: the operator's own fields plus our status and public link. */
function feedView(p: FeedPackage) {
  const site = (process.env.SITE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  return {
    externalRef: p.externalRef,
    slug: p.slug,
    status: p.status,
    publicUrl: p.status === 'PUBLISHED' ? `${site}/tours/${p.slug}` : null,
    title: p.title,
    titleRu: p.titleRu,
    descriptionRu: p.descriptionRu,
    descriptionEn: p.descriptionEn,
    countryCode: p.countryCode,
    durationDays: p.durationDays,
    price: p.price === null ? null : Number(p.price),
    currency: p.currency,
    priceBasis: p.priceBasis,
    capacity: p.capacity,
    inclusions: p.inclusions,
    exclusions: p.exclusions,
    dates: p.dateRanges.map((d) => ({ startDate: d.startDate.toISOString().slice(0, 10), endDate: d.endDate.toISOString().slice(0, 10), capacity: d.capacity })),
    updatedAt: p.updatedAt,
  };
}

/** Shared by the feed API and the spreadsheet import, so both follow the same rules as the form. */
@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    private readonly revalidation: RevalidationService,
  ) {}

  /**
   * The status a tour ends up in. Asking for "published" only works for an approved operator and a
   * tour with a Russian description (same rule as the portal form); otherwise it stays a draft.
   */
  targetStatus(op: Operator, input: FeedPackageInput): { status: PackageStatus; warnings: string[] } {
    if (!input.published) return { status: 'DRAFT', warnings: [] };
    if (op.status !== 'APPROVED') return { status: 'DRAFT', warnings: ['Kept as a draft: tours go live once your application is approved'] };
    if (!input.descriptionRu) return { status: 'DRAFT', warnings: ['Kept as a draft: add a Russian description (description_ru) to publish'] };
    return { status: 'PUBLISHED', warnings: [] };
  }

  async upsert(tx: Prisma.TransactionClient, op: Operator, ref: string, input: FeedPackageInput, actor: { accountId: string | null; via: 'api' | 'import' }) {
    await activeCountry(tx, input.countryCode);
    const { status, warnings } = this.targetStatus(op, input);
    const { published: _published, ...form } = input;
    const existing = await tx.package.findUnique({ where: { operatorId_externalRef: { operatorId: op.id, externalRef: ref } } });
    let pkg: FeedPackage;
    if (existing) {
      await tx.packageDateRange.deleteMany({ where: { packageId: existing.id } });
      pkg = await tx.package.update({ where: { id: existing.id }, data: { ...packageData(form), status }, include: feedInclude });
    } else {
      pkg = await tx.package.create({
        data: { ...packageData(form), operatorId: op.id, externalRef: ref, slug: await uniquePackageSlug(tx, form.title, op.slug), status },
        include: feedInclude,
      });
    }
    await tx.auditLog.create({
      data: { actorAccountId: actor.accountId, action: existing ? 'package.update' : 'package.create', entityType: 'package', entityId: pkg.id, metadata: { via: actor.via, externalRef: ref, status } },
    });
    return { action: existing ? ('update' as const) : ('create' as const), pkg, warnings, wasPublished: existing?.status === 'PUBLISHED' };
  }

  /** Scores and the public site after a batch of changes. */
  async afterChanges(operatorId: string, touchedPublic: boolean) {
    await this.scoring.recompute(operatorId);
    if (touchedPublic) this.revalidation.revalidate('operators');
  }
}

// ── API keys ──────────────────────────────────────────────────────────────

type FeedRequest = Request & { feedOperator?: Operator };
const FeedOperator = createParamDecorator((_: unknown, ctx: ExecutionContext): Operator => ctx.switchToHttp().getRequest<FeedRequest>().feedOperator!);

/** `Authorization: Bearer ttp_live_…`. 120 requests a minute per key. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly limiter = new RateLimiter(120, 60_000);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FeedRequest>();
    const [scheme, key] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !key?.startsWith('ttp_')) throw new UnauthorizedException('Send your API key as "Authorization: Bearer ttp_live_…"');
    const apiKey = await this.prisma.apiKey.findUnique({ where: { keyHash: sha256(key) }, include: { operator: true } });
    if (!apiKey || apiKey.revokedAt) throw new UnauthorizedException('Unknown or revoked API key');
    if (!CAN_FEED.includes(apiKey.operator.status)) throw new ForbiddenException('Your listing is not active, so the feed is paused. Contact us.');
    if (!this.limiter.take(apiKey.id)) throw new HttpException('Too many requests: at most 120 a minute per key', HttpStatus.TOO_MANY_REQUESTS);
    if (!apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() > 60_000) {
      await this.prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
    }
    req.feedOperator = apiKey.operator;
    return true;
  }
}

const refPipe = new ZodValidationPipe(externalRefSchema);

/** Package feed API v1 (docs/FEED_API.md). Tours are addressed by the operator's own id. */
@Controller('feed/v1/packages')
@UseGuards(ApiKeyGuard)
export class FeedController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feed: FeedService,
  ) {}

  @Get()
  async list(@FeedOperator() op: Operator) {
    const rows = await this.prisma.package.findMany({ where: { operatorId: op.id }, include: feedInclude, orderBy: [{ externalRef: 'asc' }, { createdAt: 'asc' }] });
    return { items: rows.map(feedView) };
  }

  @Get(':ref')
  async get(@Param('ref', refPipe) ref: string, @FeedOperator() op: Operator) {
    const p = await this.prisma.package.findUnique({ where: { operatorId_externalRef: { operatorId: op.id, externalRef: ref } }, include: feedInclude });
    if (!p) throw new NotFoundException(`No tour with external_ref "${ref}"`);
    return feedView(p);
  }

  /** Create or replace the tour with this external id. Sending the same body twice changes nothing. */
  @Put(':ref')
  async put(@Param('ref', refPipe) ref: string, @Body(new ZodValidationPipe(feedPackageSchema)) body: FeedPackageInput, @FeedOperator() op: Operator) {
    const r = await this.prisma.$transaction((tx) => this.feed.upsert(tx, op, ref, body, { accountId: null, via: 'api' }));
    await this.feed.afterChanges(op.id, r.wasPublished || r.pkg.status === 'PUBLISHED');
    return { action: r.action, warnings: r.warnings, package: feedView(r.pkg) };
  }

  /** Takes the tour off sale (archived); quotes and history stay. */
  @Delete(':ref')
  async archive(@Param('ref', refPipe) ref: string, @FeedOperator() op: Operator) {
    const p = await this.prisma.package.findUnique({ where: { operatorId_externalRef: { operatorId: op.id, externalRef: ref } } });
    if (!p) throw new NotFoundException(`No tour with external_ref "${ref}"`);
    const archived = await this.prisma.package.update({ where: { id: p.id }, data: { status: 'ARCHIVED' }, include: feedInclude });
    await this.prisma.auditLog.create({ data: { action: 'package.archived', entityType: 'package', entityId: p.id, metadata: { via: 'api', externalRef: ref } } });
    await this.feed.afterChanges(op.id, p.status === 'PUBLISHED');
    return feedView(archived);
  }
}

// ── Portal: keys and spreadsheet import ──────────────────────────────────────

function feedingOperator(a: PortalAccount): Operator {
  if (!a.operator) throw new ForbiddenException();
  if (!CAN_FEED.includes(a.operator.status)) throw new ForbiddenException('Your listing is not active, so changes are paused. Contact us.');
  return a.operator;
}

const keySelect = { id: true, name: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true } as const;

@Controller('portal/operator')
@UseGuards(PortalAuthGuard)
@PortalRoles('OPERATOR')
export class PortalFeedController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feed: FeedService,
  ) {}

  @Get('api-keys')
  keys(@CurrentAccount() a: PortalAccount) {
    return this.prisma.apiKey.findMany({ where: { operatorId: feedingOperator(a).id }, select: keySelect, orderBy: { createdAt: 'desc' } });
  }

  /** The full key is returned only here, once. */
  @Post('api-keys')
  async createKey(@Body(new ZodValidationPipe(apiKeyCreateSchema)) body: { name: string }, @CurrentAccount() a: PortalAccount) {
    const op = feedingOperator(a);
    if ((await this.prisma.apiKey.count({ where: { operatorId: op.id, revokedAt: null } })) >= MAX_ACTIVE_KEYS) {
      throw new ConflictException(`At most ${MAX_ACTIVE_KEYS} active keys; revoke one you no longer use`);
    }
    const key = `ttp_live_${randomBytes(32).toString('base64url')}`;
    const created = await this.prisma.apiKey.create({
      data: { operatorId: op.id, name: body.name, prefix: key.slice(0, 13), keyHash: sha256(key), createdById: a.id },
      select: keySelect,
    });
    await this.prisma.auditLog.create({ data: { actorAccountId: a.id, action: 'api_key.create', entityType: 'operator', entityId: op.id, metadata: { keyId: created.id } } });
    return { ...created, key };
  }

  @Delete('api-keys/:id')
  async revokeKey(@Param('id', ParseUUIDPipe) id: string, @CurrentAccount() a: PortalAccount) {
    const op = feedingOperator(a);
    const { count } = await this.prisma.apiKey.updateMany({ where: { id, operatorId: op.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count === 0) throw new NotFoundException('Key not found or already revoked');
    await this.prisma.auditLog.create({ data: { actorAccountId: a.id, action: 'api_key.revoke', entityType: 'operator', entityId: op.id, metadata: { keyId: id } } });
    return { ok: true };
  }

  /**
   * Spreadsheet import. With dryRun, reports what each row would do. Otherwise imports all rows in
   * one go, and only if none has an error, so a half-imported file never happens.
   */
  @Post('import')
  @HttpCode(200)
  async import(@Body(new ZodValidationPipe(csvImportSchema)) body: z.infer<typeof csvImportSchema>, @CurrentAccount() a: PortalAccount): Promise<ImportResult> {
    const op = feedingOperator(a);
    const parsed = rowsFromCsv(body.csv);
    if (parsed.error) throw new BadRequestException(parsed.error);
    if (!parsed.rows.length) throw new BadRequestException('No tours in the file (only a header row)');

    const existing = new Set(
      (await this.prisma.package.findMany({ where: { operatorId: op.id, externalRef: { in: parsed.rows.map((r) => r.externalRef!).filter(Boolean) } }, select: { externalRef: true } })).map((p) => p.externalRef),
    );
    const activeCodes = new Set((await this.prisma.country.findMany({ where: { active: true }, select: { code: true } })).map((c) => c.code));
    const rows = parsed.rows.map((r) => {
      const errors = [...r.errors];
      if (r.input && !activeCodes.has(r.input.countryCode)) errors.push(`country: we don't list operators in ${r.input.countryCode} yet`);
      const warnings = r.input && !errors.length ? this.feed.targetStatus(op, r.input).warnings : [];
      return {
        row: r.row,
        externalRef: r.externalRef,
        action: errors.length ? ('error' as const) : existing.has(r.externalRef) ? ('update' as const) : ('create' as const),
        published: r.input ? this.feed.targetStatus(op, r.input).status === 'PUBLISHED' : undefined,
        errors,
        warnings,
        input: r.input,
      };
    });
    const failed = rows.filter((r) => r.action === 'error').length;
    const result = (dryRun: boolean): ImportResult => ({
      dryRun,
      rows: rows.map(({ input: _input, ...r }) => r),
      created: rows.filter((r) => r.action === 'create').length,
      updated: rows.filter((r) => r.action === 'update').length,
      failed,
    });
    if (body.dryRun) return result(true);
    if (failed) throw new BadRequestException(`${failed} row(s) have errors; fix them and import again. Nothing was imported.`);

    let touchedPublic = false;
    await this.prisma.$transaction(
      async (tx) => {
        for (const r of rows) {
          const out = await this.feed.upsert(tx, op, r.externalRef!, r.input!, { accountId: a.id, via: 'import' });
          touchedPublic ||= out.wasPublished || out.pkg.status === 'PUBLISHED';
        }
      },
      { timeout: 60_000 },
    );
    await this.feed.afterChanges(op.id, touchedPublic);
    return result(false);
  }
}

@Module({ controllers: [FeedController, PortalFeedController], providers: [FeedService, ApiKeyGuard] })
export class FeedModule {}

