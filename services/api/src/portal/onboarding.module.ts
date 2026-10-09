import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Ip,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminUser, OperatorDocument, OperatorDocumentType } from '@prisma/client';
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TYPES,
  DOCUMENTS_PER_OPERATOR,
  OPERATOR_SUBMIT,
  OperatorApplicationInput,
  OperatorSignupInput,
  applicationMissing,
  operatorApplicationSchema,
  operatorSignupSchema,
} from '@ttp/shared-types';
import * as bcrypt from 'bcryptjs';
import { Response } from 'express';
import { z } from 'zod';
import { AdminAuthGuard, AdminRoles, CurrentAdmin } from '../admin-auth/admin-auth.guard';
import { activeCountry } from '../common/countries';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { NotificationsService } from '../mail/notifications.service';
import { newBadgeToken, uniqueOperatorSlug } from '../operators/operators.service';
import { ScoringService } from '../scoring/scoring.service';
import { DocumentStore } from '../storage/document-store';
import { CurrentAccount, PortalAccount, PortalAuthGuard, PortalAuthService, PortalRoles } from './portal-auth';

/** The part of a multer upload we use (memory storage). */
interface Upload {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/** Recognise the file by its first bytes, not by what the browser claims. */
export function sniffDocumentType(data: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

const EDITABLE = ['DRAFT', 'FLAGGED'] as const;
const documentSelect = { id: true, type: true, originalFilename: true, contentType: true, sizeBytes: true, reviewedAt: true, createdAt: true } as const;
const safeFilename = (name: string) => name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document';

function operatorOf(a: PortalAccount) {
  if (!a.operator) throw new ForbiddenException();
  return a.operator;
}

async function sendFile(res: Response, store: DocumentStore, doc: OperatorDocument) {
  const data = await store.get(doc.storageKey);
  if (!data) throw new NotFoundException('The file is missing from storage');
  res.set({
    'Content-Type': doc.contentType,
    'Content-Disposition': `inline; filename="${safeFilename(doc.originalFilename)}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(data);
}

/**
 * Operator self-onboarding (Phase 4): sign up, fill in the intake (TV-1), upload licence and
 * registration, send for review. Staff still decide (TV-2); nothing is public before approval.
 */
@Controller('portal')
export class OnboardingController {
  /** Five sign-ups per hour per address, against scripted spam. */
  private readonly signups = new RateLimiter(5, 60 * 60 * 1000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: PortalAuthService,
    private readonly store: DocumentStore,
    private readonly notifications: NotificationsService,
    private readonly scoring: ScoringService,
  ) {}

  /** Countries an operator can sign up from, with the authority that licenses tour operators there. */
  @Get('countries')
  countries() {
    return this.prisma.country.findMany({ where: { active: true }, select: { code: true, nameEn: true, nameRu: true, licensingAuthority: true }, orderBy: { nameEn: 'asc' } });
  }

  @Post('operator-signup')
  async signup(@Body(new ZodValidationPipe(operatorSignupSchema)) body: OperatorSignupInput, @Ip() ip: string) {
    if (!this.signups.take(ip)) throw new HttpException('Too many sign-ups from this address. Try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);
    const country = await activeCountry(this.prisma, body.countryCode);
    if (await this.prisma.account.findUnique({ where: { email: body.email } })) throw new ConflictException('This email already has a login. Sign in, or reset your password.');
    const passwordHash = await bcrypt.hash(body.password, 12);
    await this.prisma.$transaction(async (tx) => {
      const op = await tx.operator.create({
        data: {
          name: body.name,
          slug: await uniqueOperatorSlug(tx, `${body.name}-${body.countryCode}`),
          countryCode: body.countryCode,
          licensingAuthority: country.licensingAuthority ?? '',
          // Filled in on the application form before it can be submitted.
          businessRegNumber: '',
          tourismBoardLicense: '',
          address: '',
          email: body.email,
          phone: body.phone,
          status: 'DRAFT',
          badgeToken: newBadgeToken(),
        },
      });
      const account = await tx.account.create({ data: { email: body.email, passwordHash, role: 'OPERATOR', operatorId: op.id } });
      await tx.auditLog.create({ data: { actorAccountId: account.id, action: 'operator.signup', entityType: 'operator', entityId: op.id } });
    });
    return this.auth.login({ email: body.email, password: body.password });
  }

  @Get('operator/application')
  @UseGuards(PortalAuthGuard)
  @PortalRoles('OPERATOR')
  async application(@CurrentAccount() a: PortalAccount) {
    const op = await this.prisma.operator.findUniqueOrThrow({
      where: { id: operatorOf(a).id },
      include: { country: true, documents: { select: documentSelect, orderBy: { createdAt: 'asc' } } },
    });
    const { badgeToken, approvedById, ...rest } = op;
    return {
      ...rest,
      // Staff's reason is shown while it asks the operator for something; internal otherwise.
      statusReason: op.status === 'FLAGGED' || op.status === 'REJECTED' || op.status === 'SUSPENDED' ? op.statusReason : null,
      badgeToken: op.status === 'APPROVED' || op.status === 'SUSPENDED' ? badgeToken : null,
      missing: applicationMissing(op, op.documents.map((d) => d.type)),
      editable: (EDITABLE as readonly string[]).includes(op.status),
    };
  }

  @Patch('operator/application')
  @UseGuards(PortalAuthGuard)
  @PortalRoles('OPERATOR')
  async updateApplication(@Body(new ZodValidationPipe(operatorApplicationSchema)) body: OperatorApplicationInput, @CurrentAccount() a: PortalAccount) {
    const op = operatorOf(a);
    if (body.countryCode && body.countryCode !== op.countryCode) await activeCountry(this.prisma, body.countryCode);
    // Conditional update: the application can't change under a reviewer once it is submitted.
    const { count } = await this.prisma.operator.updateMany({ where: { id: op.id, status: { in: [...EDITABLE] } }, data: body });
    if (count === 0) throw new ConflictException('Your application is with our team, so it can’t be changed right now.');
    await this.prisma.auditLog.create({ data: { actorAccountId: a.id, action: 'operator.application_update', entityType: 'operator', entityId: op.id, metadata: { fields: Object.keys(body) } } });
    await this.scoring.recompute(op.id);
    return this.application(a);
  }

  @Post('operator/application/submit')
  @HttpCode(200)
  @UseGuards(PortalAuthGuard)
  @PortalRoles('OPERATOR')
  async submit(@CurrentAccount() a: PortalAccount) {
    const op = await this.prisma.operator.findUniqueOrThrow({ where: { id: operatorOf(a).id }, include: { documents: { select: { type: true } } } });
    const missing = applicationMissing(op, op.documents.map((d) => d.type));
    if (missing.length) throw new BadRequestException(`Still missing: ${missing.map((m) => m.label).join('; ')}`);
    const { count } = await this.prisma.operator.updateMany({
      where: { id: op.id, status: { in: [...OPERATOR_SUBMIT.from] } },
      data: { status: OPERATOR_SUBMIT.to, submittedAt: new Date(), statusReason: null },
    });
    if (count === 0) throw new ConflictException(`Your application is ${op.status.toLowerCase()}, so it can’t be sent again.`);
    await this.prisma.auditLog.create({ data: { actorAccountId: a.id, action: 'operator.submit', entityType: 'operator', entityId: op.id, metadata: { from: op.status } } });
    this.notifications.operatorApplied(op.id, op.status === 'FLAGGED');
    return this.application(a);
  }

  // ── Documents (licence, registration) ─────────────────────────────────────

  @Post('operator/documents')
  @UseGuards(PortalAuthGuard)
  @PortalRoles('OPERATOR')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 } }))
  async upload(@UploadedFile() file: Upload | undefined, @Body(new ZodValidationPipe(z.object({ type: z.enum(DOCUMENT_TYPES) }))) body: { type: OperatorDocumentType }, @CurrentAccount() a: PortalAccount) {
    const op = operatorOf(a);
    if (!['DRAFT', 'FLAGGED', 'APPROVED'].includes(op.status)) throw new ConflictException('Documents can’t be changed while your application is being reviewed.');
    if (!file?.size) throw new BadRequestException('Choose a file to upload');
    const contentType = sniffDocumentType(file.buffer);
    if (!contentType) throw new BadRequestException('Upload a PDF, JPEG or PNG file');
    if ((await this.prisma.operatorDocument.count({ where: { operatorId: op.id } })) >= DOCUMENTS_PER_OPERATOR) {
      throw new ConflictException(`At most ${DOCUMENTS_PER_OPERATOR} documents; remove one first`);
    }
    const storageKey = await this.store.put(`documents/${op.id}`, file.buffer);
    const doc = await this.prisma.operatorDocument.create({
      data: { operatorId: op.id, type: body.type, storageKey, originalFilename: safeFilename(file.originalname), contentType, sizeBytes: file.size },
      select: documentSelect,
    });
    await this.prisma.auditLog.create({ data: { actorAccountId: a.id, action: 'operator.document_upload', entityType: 'operator', entityId: op.id, metadata: { documentId: doc.id, type: body.type } } });
    return doc;
  }

  @Delete('operator/documents/:id')
  @UseGuards(PortalAuthGuard)
  @PortalRoles('OPERATOR')
  async removeDocument(@Param('id', ParseUUIDPipe) id: string, @CurrentAccount() a: PortalAccount) {
    const op = operatorOf(a);
    if (!(EDITABLE as readonly string[]).includes(op.status)) throw new ConflictException('Documents can only be removed from a draft or flagged application.');
    const doc = await this.prisma.operatorDocument.findFirst({ where: { id, operatorId: op.id } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.reviewedAt) throw new ConflictException('This document has been checked by our team, so it stays on file.');
    await this.prisma.operatorDocument.delete({ where: { id } });
    await this.store.remove(doc.storageKey);
    return { ok: true };
  }

  @Get('operator/documents/:id/file')
  @UseGuards(PortalAuthGuard)
  @PortalRoles('OPERATOR')
  async ownFile(@Param('id', ParseUUIDPipe) id: string, @CurrentAccount() a: PortalAccount, @Res() res: Response) {
    const doc = await this.prisma.operatorDocument.findFirst({ where: { id, operatorId: operatorOf(a).id } });
    if (!doc) throw new NotFoundException('Document not found');
    await sendFile(res, this.store, doc);
  }
}

/** Staff open and check the documents an operator uploaded. Content editors have no access. */
@Controller('admin/operators/:operatorId/documents/:id')
@UseGuards(AdminAuthGuard)
@AdminRoles('SUPER_ADMIN', 'MODERATOR')
export class AdminDocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: DocumentStore,
  ) {}

  @Get('file')
  async file(@Param('operatorId', ParseUUIDPipe) operatorId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: AdminUser, @Res() res: Response) {
    const doc = await this.prisma.operatorDocument.findFirst({ where: { id, operatorId } });
    if (!doc) throw new NotFoundException('Document not found');
    // Who looked at which licence is part of the record (B3.5: sensitive documents).
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: 'operator.document_view', entityType: 'operator', entityId: operatorId, metadata: { documentId: id } } });
    await sendFile(res, this.store, doc);
  }

  /** Marks the document checked, with what was found (e.g. "matches the UTB register"). */
  @Post('review')
  @HttpCode(200)
  async review(@Param('operatorId', ParseUUIDPipe) operatorId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ notes: z.string().trim().min(2).max(1000) }))) body: { notes: string }, @CurrentAdmin() admin: AdminUser) {
    const { count } = await this.prisma.operatorDocument.updateMany({ where: { id, operatorId }, data: { reviewNotes: body.notes, reviewedAt: new Date(), reviewedById: admin.id } });
    if (count === 0) throw new NotFoundException('Document not found');
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: 'operator.document_review', entityType: 'operator', entityId: operatorId, reason: body.notes, metadata: { documentId: id } } });
    return this.prisma.operatorDocument.findUniqueOrThrow({ where: { id }, include: { reviewedBy: { select: { id: true, name: true } } } });
  }
}

@Module({ controllers: [OnboardingController, AdminDocumentsController] })
export class OnboardingModule {}
