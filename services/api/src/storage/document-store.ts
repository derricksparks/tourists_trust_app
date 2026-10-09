import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Operators' licence and registration files (decision 2026-10-10: encrypted on our own server).
 * Each file is encrypted with AES-256-GCM before it touches the disk, so the upload folder and
 * its backups are unreadable without DOCUMENT_ENCRYPTION_KEY. Files: <UPLOAD_DIR>/<storage key>.
 */
@Injectable()
export class DocumentStore implements OnModuleInit {
  private readonly logger = new Logger(DocumentStore.name);
  private readonly root = resolve(process.env.UPLOAD_DIR ?? 'uploads');
  private readonly key = encryptionKey();

  onModuleInit() {
    if (!process.env.DOCUMENT_ENCRYPTION_KEY) this.logger.warn('DOCUMENT_ENCRYPTION_KEY is not set: using a development key derived from JWT_SECRET');
  }

  /** Stores the file and returns its storage key. */
  async put(prefix: string, data: Buffer): Promise<string> {
    const key = `${prefix}/${randomUUID()}`;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(data), cipher.final()]);
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, Buffer.concat([iv, body, cipher.getAuthTag()]), { mode: 0o600 });
    return key;
  }

  /** Decrypts a stored file; null if it is missing (e.g. demo rows without a file). */
  async get(key: string): Promise<Buffer | null> {
    let raw: Buffer;
    try {
      raw = await readFile(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]);
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  private path(key: string): string {
    // Keys are generated here, but never let one point outside the upload folder.
    if (!/^[a-z0-9/-]+$/i.test(key) || key.includes('..')) throw new Error(`Bad storage key: ${key}`);
    return join(this.root, `${key}.bin`);
  }
}

/** 32-byte key from DOCUMENT_ENCRYPTION_KEY (base64 or hex); in development, derived from JWT_SECRET. */
export function encryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const given = env.DOCUMENT_ENCRYPTION_KEY;
  if (given) {
    const key = /^[0-9a-f]{64}$/i.test(given) ? Buffer.from(given, 'hex') : Buffer.from(given, 'base64');
    if (key.length !== 32) throw new Error('DOCUMENT_ENCRYPTION_KEY must be 32 bytes, base64 or hex (openssl rand -base64 32)');
    return key;
  }
  return createHash('sha256').update(`ttp-documents:${env.JWT_SECRET ?? ''}`).digest();
}

@Global()
@Module({ providers: [DocumentStore], exports: [DocumentStore] })
export class StorageModule {}
