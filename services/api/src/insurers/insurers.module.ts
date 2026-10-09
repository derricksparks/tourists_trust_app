import { Body, Controller, Get, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminUser, Prisma } from '@prisma/client';
import { InsurerCreateInput, InsurerUpdateInput, PublicInsurer, insurerCreateSchema, insurerUpdateSchema } from '@ttp/shared-types';
import { AdminAuthGuard, AdminRoles, CurrentAdmin } from '../admin-auth/admin-auth.guard';
import { PrismaService } from '../common/prisma.service';
import { RevalidationService } from '../common/revalidation.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

/** Insurance guidance (IN-1, IN-2): informational comparison only, no underwriting or sales. */
@Controller()
export class InsurersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  @Get('public/insurers')
  async publicList(): Promise<PublicInsurer[]> {
    const rows = await this.prisma.insurer.findMany({
      where: { published: true },
      orderBy: [{ repatriationConfirmed: 'desc' }, { verifiedAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
    });
    return rows.map((i) => ({
      id: i.id,
      name: i.name,
      nameRu: i.nameRu,
      websiteUrl: i.websiteUrl,
      countriesCovered: i.countriesCovered,
      claimsContact: i.claimsContact,
      repatriationConfirmed: i.repatriationConfirmed,
      coverageRu: i.coverageRu,
      exclusionsRu: i.exclusionsRu,
      medicalLimitInfo: i.medicalLimitInfo,
      verifiedAt: i.verifiedAt?.toISOString() ?? null,
    }));
  }

  @Get('admin/insurers')
  @UseGuards(AdminAuthGuard)
  list() {
    return this.prisma.insurer.findMany({ orderBy: { name: 'asc' }, include: { verifiedBy: { select: { name: true } } } });
  }

  @Get('admin/insurers/:id')
  @UseGuards(AdminAuthGuard)
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const i = await this.prisma.insurer.findUnique({ where: { id }, include: { verifiedBy: { select: { name: true } } } });
    if (!i) throw new NotFoundException('Insurer not found');
    return i;
  }

  @Post('admin/insurers')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('SUPER_ADMIN', 'CONTENT_EDITOR')
  async create(@Body(new ZodValidationPipe(insurerCreateSchema)) body: InsurerCreateInput, @CurrentAdmin() admin: AdminUser) {
    const { factsVerified, ...data } = body;
    const i = await this.prisma.insurer.create({ data: { ...data, ...(factsVerified && { verifiedAt: new Date(), verifiedById: admin.id }) } });
    await this.audit(admin, 'insurer.create', i.id, { published: i.published, factsVerified: !!factsVerified });
    return i;
  }

  @Patch('admin/insurers/:id')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('SUPER_ADMIN', 'CONTENT_EDITOR')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(insurerUpdateSchema)) body: InsurerUpdateInput, @CurrentAdmin() admin: AdminUser) {
    const { factsVerified, ...data } = body;
    const i = await this.prisma.insurer
      .update({ where: { id }, data: { ...data, ...(factsVerified && { verifiedAt: new Date(), verifiedById: admin.id }) } })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Insurer not found');
        throw e;
      });
    await this.audit(admin, 'insurer.update', id, { fields: Object.keys(data), factsVerified: !!factsVerified });
    return i;
  }

  private async audit(admin: AdminUser, action: string, entityId: string, metadata: Prisma.InputJsonObject) {
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action, entityType: 'insurer', entityId, metadata } });
    this.revalidation.revalidate('guides');
  }
}

@Module({ controllers: [InsurersController] })
export class InsurersModule {}
