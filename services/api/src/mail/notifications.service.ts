import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Account } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { MailModule, MailService } from './mail.service';

const url = (name: string, fallback: string) => (process.env[name] ?? fallback).replace(/\/$/, '');
const portalUrl = () => url('PORTAL_URL', 'http://localhost:5174');
const adminUrl = () => url('ADMIN_URL', 'http://localhost:5173');
const ruDate = (d: Date | null) => !d ? 'даты не указаны' : d.toISOString().slice(0, 10).split('-').reverse().join('.');
const enDate = (d: Date | null) => !d ? 'not given' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const SIGN_RU = '\n\n—\nКоманда «Проверено: Африка»\nЭто автоматическое письмо. Если есть вопросы, просто ответьте на него.';
const SIGN_EN = '\n\n—\nPartner team, Проверено: Африка (verified Russia–Africa tourism)\nThis is an automatic email. Reply to it if you have questions.';

/**
 * Who gets told what, and in which language: operators in English, Russian DMCs in Russian,
 * staff in English. Partners are reached through their active portal logins.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Notifications follow an action that already succeeded, so a failure here is only logged. */
  private run(what: string, fn: () => Promise<void>) {
    fn().catch((e: Error) => this.logger.error(`Notification ${what} failed: ${e.message}`));
  }

  private async operatorLogins(operatorId: string) {
    return (await this.prisma.account.findMany({ where: { operatorId, active: true }, select: { email: true } })).map((a) => a.email);
  }

  private async dmcLogins(dmcId: string) {
    return (await this.prisma.account.findMany({ where: { dmcId, active: true }, select: { email: true } })).map((a) => a.email);
  }

  /** Set-password link for a new login or a reset. Awaited, so the caller can say whether it went out. */
  async passwordLink(account: Pick<Account, 'email' | 'role'>, link: string, kind: 'new' | 'reset') {
    const ru = account.role === 'DMC';
    const subject = ru
      ? kind === 'new' ? 'Доступ к кабинету партнёра' : 'Новый пароль для кабинета партнёра'
      : kind === 'new' ? 'Your partner portal login' : 'Reset your partner portal password';
    const text = ru
      ? `Здравствуйте!\n\n${kind === 'new' ? 'Для вас создан вход в кабинет партнёра.' : 'Мы получили запрос на смену пароля.'} Задайте пароль по ссылке (она работает 7 дней и только один раз):\n\n${link}\n\nВаш логин: ${account.email}${kind === 'reset' ? '\n\nЕсли вы не запрашивали смену пароля, просто проигнорируйте это письмо.' : ''}${SIGN_RU}`
      : `Hello,\n\n${kind === 'new' ? 'We have created a login for you on the partner portal, where you manage your tours and answer quote requests from Russian travel companies.' : 'We received a request to reset your password.'} Set your password here (the link works once, for 7 days):\n\n${link}\n\nYour login: ${account.email}${kind === 'reset' ? '\n\nIf you did not ask for this, ignore this email.' : ''}${SIGN_EN}`;
    await this.mail.send({ to: [account.email], subject, text });
  }

  dmcApplied(dmc: { id: string; name: string; contactName: string | null; email: string | null; websiteUrl: string | null }) {
    this.mail.notify({
      to: this.mail.staffRecipients(),
      subject: `New DMC application: ${dmc.name}`,
      text: `${dmc.name} applied for wholesale access.\n\nContact: ${dmc.contactName ?? 'not given'}, ${dmc.email ?? 'no email'}\nWebsite: ${dmc.websiteUrl ?? 'not given'}\n\nCheck and decide: ${adminUrl()}/dmcs`,
    });
    if (dmc.email) {
      this.mail.notify({
        to: [dmc.email],
        subject: 'Заявка получена',
        text: `Здравствуйте${dmc.contactName ? `, ${dmc.contactName}` : ''}!\n\nСпасибо за заявку от «${dmc.name}». Мы проверим компанию и откроем доступ к каталогу туров, обычно в течение двух рабочих дней. Мы напишем, когда всё будет готово.\n\nКабинет: ${portalUrl()}${SIGN_RU}`,
      });
    }
  }

  dmcDecided(dmcId: string, decision: 'approve' | 'reject' | 'suspend', reason?: string): void {
    this.run('dmcDecided', async () => {
      const dmc = await this.prisma.dmc.findUniqueOrThrow({ where: { id: dmcId } });
      const why = reason ? `\n\nПричина: ${reason}` : '';
      const body = {
        approve: { subject: 'Доступ открыт', text: `Компания «${dmc.name}» проверена. Каталог туров с ценами нетто, запросы цен и ознакомительные поездки теперь доступны в кабинете:\n\n${portalUrl()}` },
        reject: { subject: 'Заявка отклонена', text: `К сожалению, мы не можем открыть доступ для «${dmc.name}».${why}\n\nЕсли что-то изменилось, ответьте на это письмо.` },
        suspend: { subject: 'Доступ приостановлен', text: `Доступ к каталогу для «${dmc.name}» приостановлен.${why}\n\nОтветьте на это письмо, чтобы обсудить.` },
      }[decision];
      this.mail.notify({ to: await this.dmcLogins(dmcId), subject: body.subject, text: `Здравствуйте!\n\n${body.text}${SIGN_RU}` });
    });
  }

  quoteRequested(quoteId: string): void {
    this.run('quoteRequested', async () => {
      const q = await this.prisma.quoteRequest.findUniqueOrThrow({ where: { id: quoteId }, include: { dmc: true, package: { include: { operator: true } } } });
      const op = q.package.operator;
      const details = `Tour: ${q.package.title}\nFrom: ${q.dmc.name} (Russia)\nTravellers: ${q.pax}\nDates: ${enDate(q.travelStartDate)}${q.travelEndDate ? ` – ${enDate(q.travelEndDate)}` : ''}${q.notes ? `\nNotes: ${q.notes}` : ''}`;
      const logins = await this.operatorLogins(op.id);
      if (logins.length) {
        this.mail.notify({
          to: logins,
          subject: `Quote request: ${q.package.title} (${q.pax} pax)`,
          text: `Hello,\n\nA Russian travel company has asked for your net price.\n\n${details}\n\nAnswer in the portal: ${portalUrl()}/quotes\n\nHow fast you answer counts towards your response-time score, which DMCs see when choosing a partner.${SIGN_EN}`,
        });
      } else {
        // No one at the operator can sign in yet, so staff pass it on.
        this.mail.notify({
          to: this.mail.staffRecipients(),
          subject: `Quote request for ${op.name}, who has no portal login`,
          text: `${details}\n\n${op.name} has no active portal login, so nobody there was emailed. Pass it on (${op.email ?? op.phone ?? 'no contact on file'}) or create a login: ${adminUrl()}/operators/${op.id}`,
        });
      }
    });
  }

  quoteAnswered(quoteId: string, reason?: string): void {
    this.run('quoteAnswered', async () => {
      const q = await this.prisma.quoteRequest.findUniqueOrThrow({ where: { id: quoteId }, include: { package: { include: { operator: true } } } });
      const title = q.package.titleRu ?? q.package.title;
      const text =
        q.status === 'QUOTED'
          ? `${q.package.operator.name} ответил на ваш запрос по туру «${title}» (${q.pax} чел., ${q.travelStartDate ? `с ${ruDate(q.travelStartDate)}` : 'даты не указаны'}).\n\nЦена нетто: ${q.quotedPrice?.toString()} ${q.quotedCurrency}${q.quoteTerms ? `\nУсловия: ${q.quoteTerms}` : ''}\n\nПодробнее: ${portalUrl()}/quotes`
          : `${q.package.operator.name} не сможет принять группу по туру «${title}» (${q.pax} чел., ${q.travelStartDate ? `с ${ruDate(q.travelStartDate)}` : 'даты не указаны'}).${reason ? `\n\nПричина: ${reason}` : ''}\n\nПосмотрите другие туры в каталоге: ${portalUrl()}`;
      this.mail.notify({ to: await this.dmcLogins(q.dmcId), subject: q.status === 'QUOTED' ? `Цена по туру «${title}»` : `Отказ по туру «${title}»`, text: `Здравствуйте!\n\n${text}${SIGN_RU}` });
    });
  }

  famTripRequested(famTripId: string, dmcId: string, representativeName: string): void {
    this.run('famTripRequested', async () => {
      const [trip, dmc] = await Promise.all([this.prisma.famTrip.findUniqueOrThrow({ where: { id: famTripId } }), this.prisma.dmc.findUniqueOrThrow({ where: { id: dmcId } })]);
      this.mail.notify({
        to: this.mail.staffRecipients(),
        subject: `Fam trip request: ${dmc.name} for ${trip.title}`,
        text: `${dmc.name} wants to send ${representativeName} on ${trip.title} (${enDate(trip.startDate)} – ${enDate(trip.endDate)}).\n\nConfirm or decline: ${adminUrl()}/fam-trips/${trip.id}`,
      });
    });
  }

  famTripDmcConfirmed(famTripId: string, dmcId: string): void {
    this.run('famTripDmcConfirmed', async () => {
      const trip = await this.prisma.famTrip.findUniqueOrThrow({ where: { id: famTripId } });
      this.mail.notify({
        to: await this.dmcLogins(dmcId),
        subject: `Место в поездке подтверждено: ${trip.title}`,
        text: `Здравствуйте!\n\nВаше участие в ознакомительной поездке «${trip.title}» (${ruDate(trip.startDate)} – ${ruDate(trip.endDate)}) подтверждено. Программа по дням — в кабинете: ${portalUrl()}/fam-trips\n\nМы свяжемся с вами по деталям перелёта и визы.${SIGN_RU}`,
      });
    });
  }

  famTripOperatorAdded(famTripId: string, operatorId: string): void {
    this.run('famTripOperatorAdded', async () => {
      const trip = await this.prisma.famTrip.findUniqueOrThrow({ where: { id: famTripId } });
      this.mail.notify({
        to: await this.operatorLogins(operatorId),
        subject: `You're invited to host a fam trip: ${trip.title}`,
        text: `Hello,\n\nWe'd like you to host Russian travel companies on "${trip.title}" (${enDate(trip.startDate)} – ${enDate(trip.endDate)}).\n\nSee the plan and confirm in the portal: ${portalUrl()}/fam-trips${SIGN_EN}`,
      });
    });
  }
}

@Global()
@Module({ imports: [MailModule], providers: [NotificationsService], exports: [NotificationsService, MailModule] })
export class NotificationsModule {}
