import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminUser, Prisma } from '@prisma/client';
import {
  DestinationGuideCreateInput,
  DestinationGuideUpdateInput,
  VisaGuideCreateInput,
  VisaGuideUpdateInput,
  destinationGuideCreateSchema,
  destinationGuideUpdateSchema,
  visaGuideCreateSchema,
  visaGuideUpdateSchema,
} from '@ttp/shared-types';
import { AdminAuthGuard, AdminRoles, CurrentAdmin } from '../admin-auth/admin-auth.guard';
import { PrismaService } from '../common/prisma.service';
import { RevalidationService } from '../common/revalidation.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

function mapError(what: string) {
  return (e: unknown): never => {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025') throw new NotFoundException(`${what} not found`);
      if (e.code === 'P2002') throw new ConflictException('That web address (slug) is already used');
      if (e.code === 'P2003') throw new BadRequestException('Unknown country code');
    }
    throw e;
  };
}

/** Publishing, or ticking "facts verified", stamps last_updated: the date shown to readers. */
const stamp = (input: { status?: string; factsVerified?: boolean }) =>
  input.factsVerified || input.status === 'PUBLISHED' ? { lastUpdated: new Date() } : {};

/** Visa guides (VI-1, VI-2) and destination / logistics guides (FL-1), edited by content editors. */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminContentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  @Get('visa-guides')
  visaGuides() {
    return this.prisma.visaGuide.findMany({ orderBy: [{ countryCode: 'asc' }, { titleRu: 'asc' }] });
  }

  @Get('visa-guides/:id')
  async visaGuide(@Param('id', ParseUUIDPipe) id: string) {
    const g = await this.prisma.visaGuide.findUnique({ where: { id } });
    if (!g) throw new NotFoundException('Visa guide not found');
    return g;
  }

  @Post('visa-guides')
  @AdminRoles('SUPER_ADMIN', 'CONTENT_EDITOR')
  async createVisaGuide(@Body(new ZodValidationPipe(visaGuideCreateSchema)) body: VisaGuideCreateInput, @CurrentAdmin() admin: AdminUser) {
    const { factsVerified, checklistItems, ...data } = body;
    const g = await this.prisma.visaGuide
      .create({ data: { ...data, checklistItems, ...stamp(body) } })
      .catch(mapError('Visa guide'));
    await this.audit(admin, 'visa_guide.create', 'visa_guide', g.id, { status: g.status, factsVerified });
    return g;
  }

  @Patch('visa-guides/:id')
  @AdminRoles('SUPER_ADMIN', 'CONTENT_EDITOR')
  async updateVisaGuide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(visaGuideUpdateSchema)) body: VisaGuideUpdateInput,
    @CurrentAdmin() admin: AdminUser,
  ) {
    const { factsVerified, ...data } = body;
    const g = await this.prisma.visaGuide.update({ where: { id }, data: { ...data, ...stamp(body) } }).catch(mapError('Visa guide'));
    await this.audit(admin, 'visa_guide.update', 'visa_guide', id, { fields: Object.keys(data), factsVerified });
    return g;
  }

  @Get('guides')
  guides() {
    return this.prisma.destinationGuide.findMany({ orderBy: [{ countryCode: 'asc' }, { kind: 'asc' }, { titleRu: 'asc' }] });
  }

  @Get('guides/:id')
  async guide(@Param('id', ParseUUIDPipe) id: string) {
    const g = await this.prisma.destinationGuide.findUnique({ where: { id } });
    if (!g) throw new NotFoundException('Guide not found');
    return g;
  }

  @Post('guides')
  @AdminRoles('SUPER_ADMIN', 'CONTENT_EDITOR')
  async createGuide(@Body(new ZodValidationPipe(destinationGuideCreateSchema)) body: DestinationGuideCreateInput, @CurrentAdmin() admin: AdminUser) {
    const { factsVerified, ...data } = body;
    const g = await this.prisma.destinationGuide
      .create({ data: { ...data, ...stamp(body), ...(data.status === 'PUBLISHED' && { publishedAt: new Date() }) } })
      .catch(mapError('Guide'));
    await this.audit(admin, 'guide.create', 'destination_guide', g.id, { status: g.status, factsVerified });
    return g;
  }

  @Patch('guides/:id')
  @AdminRoles('SUPER_ADMIN', 'CONTENT_EDITOR')
  async updateGuide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(destinationGuideUpdateSchema)) body: DestinationGuideUpdateInput,
    @CurrentAdmin() admin: AdminUser,
  ) {
    const { factsVerified, ...data } = body;
    const current = await this.prisma.destinationGuide.findUnique({ where: { id }, select: { publishedAt: true } });
    if (!current) throw new NotFoundException('Guide not found');
    const g = await this.prisma.destinationGuide
      .update({
        where: { id },
        data: { ...data, ...stamp(body), ...(data.status === 'PUBLISHED' && !current.publishedAt && { publishedAt: new Date() }) },
      })
      .catch(mapError('Guide'));
    await this.audit(admin, 'guide.update', 'destination_guide', id, { fields: Object.keys(data), factsVerified });
    return g;
  }

  private async audit(admin: AdminUser, action: string, entityType: string, entityId: string, metadata: Prisma.InputJsonObject) {
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action, entityType, entityId, metadata } });
    this.revalidation.revalidate('guides');
  }
}

@Module({ controllers: [AdminContentController] })
export class ContentModule {}
