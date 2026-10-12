import { Body, Controller, Delete, Get, GoneException, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { AdminUser, OperatorDocument } from '@prisma/client';
import {
  AdminSiteSettings,
  DEFAULT_DISCLAIMERS,
  PublicDisclaimers,
  SiteSettingKey,
  SiteSettingsUpdateInput,
  siteSettingsUpdateSchema,
} from '@ttp/shared-types';
import { z } from 'zod';
import { AdminAuthGuard, AdminRoles, CurrentAdmin } from '../admin-auth/admin-auth.guard';
import { PrismaService } from '../common/prisma.service';
import { RevalidationService } from '../common/revalidation.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DocumentStore } from '../storage/document-store';

const FIELD_KEYS: Record<keyof SiteSettingsUpdateInput, SiteSettingKey> = {
  disclaimerVisa: 'disclaimer.visa',
  disclaimerInsurance: 'disclaimer.insurance',
  documentRetentionDays: 'documents.retention_days',
};

/**
 * Settings a super admin changes without a code change (pilot round): the disclaimers shown on
 * the visa and insurance pages, so a lawyer's wording can be dropped in, and how long operators'
 * licence copies are kept.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  private async values() {
    const rows = await this.prisma.siteSetting.findMany({ include: { updatedBy: { select: { name: true } } } });
    return new Map(rows.map((r) => [r.key as SiteSettingKey, r]));
  }

  async disclaimers(): Promise<PublicDisclaimers> {
    const v = await this.values();
    return { visa: v.get('disclaimer.visa')?.value ?? DEFAULT_DISCLAIMERS.visa, insurance: v.get('disclaimer.insurance')?.value ?? DEFAULT_DISCLAIMERS.insurance };
  }

  async retentionDays(): Promise<number | null> {
    const row = await this.prisma.siteSetting.findUnique({ where: { key: 'documents.retention_days' } });
    return row?.value ? Number(row.value) : null;
  }

  async admin(): Promise<AdminSiteSettings> {
    const v = await this.values();
    const days = v.get('documents.retention_days')?.value;
    return {
      disclaimerVisa: v.get('disclaimer.visa')?.value ?? DEFAULT_DISCLAIMERS.visa,
      disclaimerInsurance: v.get('disclaimer.insurance')?.value ?? DEFAULT_DISCLAIMERS.insurance,
      disclaimerVisaIsDefault: !v.has('disclaimer.visa'),
      disclaimerInsuranceIsDefault: !v.has('disclaimer.insurance'),
      documentRetentionDays: days ? Number(days) : null,
      updated: [...v.values()].map((r) => ({ key: r.key as SiteSettingKey, at: r.updatedAt.toISOString(), by: r.updatedBy?.name ?? null })),
    };
  }

  async update(input: SiteSettingsUpdateInput, admin: AdminUser) {
    await this.prisma.$transaction(async (tx) => {
      for (const [field, key] of Object.entries(FIELD_KEYS) as [keyof SiteSettingsUpdateInput, SiteSettingKey][]) {
        if (input[field] === undefined) continue;
        const before = await tx.siteSetting.findUnique({ where: { key } });
        // Retention "keep until deleted by hand" is stored as no row at all.
        const value = input[field] === null ? null : String(input[field]);
        if ((before?.value ?? null) === value) continue;
        const row = value === null ? before && (await tx.siteSetting.delete({ where: { key } })) : await tx.siteSetting.upsert({ where: { key }, create: { key, value, updatedById: admin.id }, update: { value, updatedById: admin.id } });
        if (!row) continue;
        await tx.auditLog.create({
          data: { actorAdminId: admin.id, action: 'setting.update', entityType: 'site_setting', entityId: row.id, metadata: { key, before: before?.value ?? null, after: value } },
        });
      }
    });
    if (input.disclaimerVisa !== undefined || input.disclaimerInsurance !== undefined) this.revalidation.revalidate('guides');
    return this.admin();
  }
}

/**
 * Operators' licence and registration copies past the retention period, and deleting them.
 * The file is erased from disk; the row stays (who deleted it, when) and the operator's history
 * records it, so we can still show that a licence was checked.
 */
@Injectable()
export class DocumentRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: DocumentStore,
    private readonly settings: SettingsService,
  ) {}

  async due() {
    const days = await this.settings.retentionDays();
    if (!days) return { retentionDays: null, documents: [] };
    const before = new Date(Date.now() - days * 86_400_000);
    const documents = await this.prisma.operatorDocument.findMany({
      where: { deletedAt: null, createdAt: { lt: before } },
      select: { id: true, type: true, originalFilename: true, createdAt: true, reviewedAt: true, operator: { select: { id: true, name: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { retentionDays: days, documents };
  }

  async delete(doc: OperatorDocument, admin: AdminUser, reason: string, retention: number | null = null) {
    if (doc.deletedAt) throw new GoneException('This document was already deleted');
    await this.prisma.$transaction([
      this.prisma.operatorDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date(), deletedById: admin.id } }),
      this.prisma.auditLog.create({
        data: {
          actorAdminId: admin.id,
          action: 'operator.document_delete',
          entityType: 'operator',
          entityId: doc.operatorId,
          reason,
          metadata: { documentId: doc.id, type: doc.type, filename: doc.originalFilename, uploadedAt: doc.createdAt.toISOString(), ...(retention && { retentionDays: retention }) },
        },
      }),
    ]);
    // After the record: if erasing fails the row still says deleted, and the file is unreadable
    // to everyone (all reads check deletedAt). Retry by hand from the upload folder if needed.
    await this.store.remove(doc.storageKey);
  }

  async purge(admin: AdminUser) {
    const { retentionDays, documents } = await this.due();
    for (const d of documents) {
      const doc = await this.prisma.operatorDocument.findUniqueOrThrow({ where: { id: d.id } });
      await this.delete(doc, admin, `Retention period of ${retentionDays} days passed`, retentionDays);
    }
    return { deleted: documents.length };
  }
}

@Controller()
export class PublicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Disclaimer wording for the visa and insurance pages. */
  @Get('public/disclaimers')
  disclaimers() {
    return this.settings.disclaimers();
  }
}

@Controller('admin/settings')
@UseGuards(AdminAuthGuard)
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.admin();
  }

  @Put()
  @AdminRoles('SUPER_ADMIN')
  update(@Body(new ZodValidationPipe(siteSettingsUpdateSchema)) body: SiteSettingsUpdateInput, @CurrentAdmin() admin: AdminUser) {
    return this.settings.update(body, admin);
  }
}

const deleteBody = z.object({ reason: z.string().trim().min(3).max(500) });

@Controller('admin')
@UseGuards(AdminAuthGuard)
@AdminRoles('SUPER_ADMIN', 'MODERATOR')
export class AdminDocumentRetentionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly retention: DocumentRetentionService,
  ) {}

  /** Licence copies older than the retention period that are still on disk. */
  @Get('documents/retention')
  due() {
    return this.retention.due();
  }

  @Post('documents/retention/purge')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN')
  purge(@CurrentAdmin() admin: AdminUser) {
    return this.retention.purge(admin);
  }

  @Delete('operators/:operatorId/documents/:id')
  async delete(
    @Param('operatorId', ParseUUIDPipe) operatorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(deleteBody)) body: { reason: string },
    @CurrentAdmin() admin: AdminUser,
  ) {
    const doc = await this.prisma.operatorDocument.findFirst({ where: { id, operatorId } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.retention.delete(doc, admin, body.reason);
    return this.prisma.operatorDocument.findUniqueOrThrow({ where: { id }, include: { deletedBy: { select: { id: true, name: true } } } });
  }
}

@Module({
  controllers: [PublicSettingsController, AdminSettingsController, AdminDocumentRetentionController],
  providers: [SettingsService, DocumentRetentionService],
  exports: [SettingsService],
})
export class SettingsModule {}
