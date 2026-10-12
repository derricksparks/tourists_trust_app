/**
 * Pilot check: does our email reach real mailboxes?
 *   node dist/cli/send-test-email.js you@mail.ru you@yandex.ru you@gmail.com [--dkim-selector=s1]
 * Uses the same settings as the API (SMTP_URL, MAIL_FROM, MAIL_FROM_NAME, MAIL_REPLY_TO). First it
 * looks up the sender domain's SPF and DMARC records (and DKIM, given the selector your provider
 * uses), then sends one plain message per address and prints whether the server accepted it.
 * "Accepted" means the provider took the message; then check each inbox AND its spam folder.
 * Exits with code 1 if any send failed.
 */
import { promises as dns } from 'dns';
import { createTransport, Transporter } from 'nodemailer';
import { senderFromEnv } from '../mail/mail.service';

export interface SendResult { address: string; ok: boolean; detail: string }
export interface DnsCheck { record: string; name: string; ok: boolean; detail: string }
type Resolver = { resolveTxt(name: string): Promise<string[][]> };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function checkSenderDns(domain: string, dkimSelector?: string, resolver: Resolver = dns): Promise<DnsCheck[]> {
  const txt = async (name: string) => {
    try {
      return (await resolver.resolveTxt(name)).map((parts) => parts.join(''));
    } catch {
      return [];
    }
  };
  const checks: DnsCheck[] = [];
  const spf = (await txt(domain)).filter((r) => r.toLowerCase().startsWith('v=spf1'));
  checks.push({
    record: 'SPF',
    name: domain,
    ok: spf.length === 1,
    detail: spf.length === 0 ? 'missing: add the TXT record from docs/DEPLOY.md §3' : spf.length > 1 ? `${spf.length} SPF records: merge them into one` : spf[0],
  });
  const dmarc = (await txt(`_dmarc.${domain}`)).filter((r) => r.toUpperCase().startsWith('V=DMARC1'));
  checks.push({ record: 'DMARC', name: `_dmarc.${domain}`, ok: dmarc.length === 1, detail: dmarc[0] ?? 'missing: add the TXT record from docs/DEPLOY.md §3' });
  if (dkimSelector) {
    const dkim = (await txt(`${dkimSelector}._domainkey.${domain}`)).filter((r) => /p=/.test(r));
    checks.push({ record: 'DKIM', name: `${dkimSelector}._domainkey.${domain}`, ok: dkim.length > 0, detail: dkim.length ? 'found' : 'missing or not published yet' });
  }
  return checks;
}

export async function sendTestEmails(transport: Transporter, addresses: string[], opts: { from: ReturnType<typeof senderFromEnv>; replyTo?: string; runId: string }): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (const address of addresses) {
    if (!EMAIL.test(address)) {
      results.push({ address, ok: false, detail: 'not an email address' });
      continue;
    }
    try {
      const info = await transport.sendMail({
        from: opts.from,
        replyTo: opts.replyTo,
        to: address,
        subject: `Проверка доставки / Delivery test ${opts.runId}`,
        text:
          `Это тестовое письмо платформы «Проверено: Африка». Если вы видите его во «Входящих», доставка работает.\n` +
          `This is a delivery test from the platform. If it is in your inbox (not spam), delivery works.\n\nTest ${opts.runId}`,
      });
      const rejected = (info.rejected ?? []).map(String);
      results.push(rejected.length ? { address, ok: false, detail: `rejected: ${info.response}` } : { address, ok: true, detail: `accepted (${info.messageId}) ${info.response ?? ''}`.trim() });
    } catch (e) {
      results.push({ address, ok: false, detail: (e as Error).message });
    }
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const selector = args.find((a) => a.startsWith('--dkim-selector='))?.split('=')[1];
  const addresses = args.filter((a) => !a.startsWith('--'));
  if (!addresses.length) {
    console.error('Usage: node dist/cli/send-test-email.js <address> [<address> …] [--dkim-selector=<selector>]');
    process.exit(2);
  }
  if (!process.env.SMTP_URL || !process.env.MAIL_FROM) {
    console.error('Set SMTP_URL and MAIL_FROM first (in infra/production/.env on the server).');
    process.exit(2);
  }
  const domain = process.env.MAIL_FROM.split('@')[1];
  console.log(`Sender ${process.env.MAIL_FROM}: DNS records for ${domain}`);
  for (const c of await checkSenderDns(domain, selector)) console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${c.record.padEnd(5)} ${c.name}: ${c.detail}`);
  if (!selector) console.log('  (DKIM not checked: pass --dkim-selector=<selector> from your provider)');

  const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  console.log(`\nSending test ${runId}:`);
  const results = await sendTestEmails(createTransport(process.env.SMTP_URL), addresses, { from: senderFromEnv(), replyTo: process.env.MAIL_REPLY_TO || undefined, runId });
  for (const r of results) console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.address}: ${r.detail}`);
  console.log(`\nNow open each mailbox and look for "Delivery test ${runId}" in the inbox. If it is in spam, see docs/DEPLOY.md §3.`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

if (require.main === module) void main();
