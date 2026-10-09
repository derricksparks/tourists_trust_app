import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

export interface Mail {
  to: string[];
  subject: string;
  text: string;
}

/**
 * Outgoing email over SMTP, so any provider works (set SMTP_URL, MAIL_FROM and optionally
 * MAIL_FROM_NAME). Without SMTP_URL nothing is sent: messages are logged and kept in `sent`
 * (development and tests).
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string | { name: string; address: string };
  private readonly replyTo: string | undefined;
  /** Last messages handled without an SMTP server (newest last). */
  readonly sent: Mail[] = [];

  constructor() {
    const url = process.env.SMTP_URL;
    this.transport = url ? createTransport(url) : null;
    const address = process.env.MAIL_FROM ?? 'no-reply@localhost';
    // The name is passed separately so it can contain anything ("Проверено: Африка" has a colon).
    this.from = process.env.MAIL_FROM_NAME ? { name: process.env.MAIL_FROM_NAME, address } : address;
    this.replyTo = process.env.MAIL_REPLY_TO || undefined;
  }

  get configured(): boolean {
    return this.transport !== null;
  }

  onModuleInit() {
    if (this.transport && !process.env.MAIL_FROM) throw new Error('Set MAIL_FROM (the sender address) together with SMTP_URL');
    if (!this.transport && process.env.NODE_ENV === 'production') this.logger.warn('SMTP_URL is not set: emails are only logged, not sent');
  }

  /** Staff inbox for things that need a person (new DMC applications, fam-trip requests). */
  staffRecipients(): string[] {
    return (process.env.STAFF_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  /** Sends now and reports failure to the caller. */
  async send(mail: Mail): Promise<void> {
    const to = [...new Set(mail.to)];
    if (!to.length) return;
    if (!this.transport) {
      this.sent.push({ ...mail, to });
      if (this.sent.length > 100) this.sent.shift();
      this.logger.log(`Email not sent (no SMTP_URL) to ${to.join(', ')}: ${mail.subject}`);
      return;
    }
    // One message per recipient, so partners never see each other's addresses.
    for (const address of to) {
      await this.transport.sendMail({ from: this.from, replyTo: this.replyTo, to: address, subject: mail.subject, text: mail.text });
    }
  }

  /** Best effort: the action that triggered the email has already happened, so a failure is only logged. */
  notify(mail: Mail): void {
    this.send(mail).catch((e: Error) => this.logger.error(`Email "${mail.subject}" failed: ${e.message}`));
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
