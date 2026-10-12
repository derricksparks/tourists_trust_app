import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotificationChannelKind } from '@ttp/shared-types';
import { PrismaService } from '../common/prisma.service';
import { MailService } from './mail.service';

/** What we tell an operator; every channel gets the same subject and plain text. */
export interface OutgoingMessage {
  subject: string;
  text: string;
}

/** Everything a channel may use to reach an operator. */
export interface OperatorContact {
  operatorId: string;
  name: string;
  /** Active portal logins. */
  emails: string[];
  phone: string | null;
  telegramUsername: string | null;
}

/**
 * A way of notifying operators (pilot round). Email is the only one today. To add Telegram or
 * WhatsApp: implement this, register it in NOTIFICATION_CHANNEL_PROVIDERS below, and add its
 * kind to AVAILABLE_NOTIFICATION_CHANNELS in shared-types so operators can choose it.
 */
export interface NotificationChannel {
  readonly kind: NotificationChannelKind;
  /** The addresses this channel would deliver to for this operator; empty if it can't reach them. */
  addresses(contact: OperatorContact): string[];
  send(to: string[], message: OutgoingMessage): Promise<void>;
}

@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly kind = 'EMAIL' as const;
  constructor(private readonly mail: MailService) {}

  addresses(contact: OperatorContact) {
    return contact.emails;
  }

  send(to: string[], message: OutgoingMessage) {
    return this.mail.send({ to, subject: message.subject, text: message.text });
  }
}

export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');

/** The channels the API can use. Add new channel classes here. */
export const NOTIFICATION_CHANNEL_PROVIDERS = [
  EmailChannel,
  { provide: NOTIFICATION_CHANNELS, useFactory: (email: EmailChannel): NotificationChannel[] => [email], inject: [EmailChannel] },
];

/**
 * Sends an operator a message on the channel they chose, falling back to email when that
 * channel isn't available or can't reach them (e.g. no linked Telegram chat).
 */
@Injectable()
export class OperatorNotifier {
  private readonly logger = new Logger(OperatorNotifier.name);
  private readonly byKind: Map<NotificationChannelKind, NotificationChannel>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_CHANNELS) channels: NotificationChannel[],
  ) {
    this.byKind = new Map(channels.map((c) => [c.kind, c]));
  }

  /** Can anyone at the operator be reached at all? (Otherwise staff are told instead.) */
  async reachable(operatorId: string): Promise<boolean> {
    return !!(await this.route(await this.contact(operatorId)));
  }

  /** Returns where it went, or null when nobody at the operator can be reached. */
  async send(operatorId: string, message: OutgoingMessage): Promise<{ channel: NotificationChannelKind; to: string[] } | null> {
    const route = await this.route(await this.contact(operatorId));
    if (!route) return null;
    await route.channel.send(route.to, message);
    return { channel: route.channel.kind, to: route.to };
  }

  private async contact(operatorId: string): Promise<OperatorContact & { preferred: NotificationChannelKind }> {
    const op = await this.prisma.operator.findUniqueOrThrow({
      where: { id: operatorId },
      select: { id: true, name: true, phone: true, telegramUsername: true, preferredChannel: true, accounts: { where: { active: true }, select: { email: true } } },
    });
    return { operatorId: op.id, name: op.name, emails: op.accounts.map((a) => a.email), phone: op.phone, telegramUsername: op.telegramUsername, preferred: op.preferredChannel };
  }

  private async route(contact: OperatorContact & { preferred: NotificationChannelKind }) {
    const preferred = this.byKind.get(contact.preferred);
    const email = this.byKind.get('EMAIL');
    for (const channel of [preferred, email]) {
      if (!channel) continue;
      const to = channel.addresses(contact);
      if (to.length) {
        if (channel !== preferred) this.logger.warn(`${contact.name} prefers ${contact.preferred}, which can't reach them; using ${channel.kind}`);
        return { channel, to };
      }
    }
    return null;
  }
}
