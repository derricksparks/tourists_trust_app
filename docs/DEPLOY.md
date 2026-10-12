# Running the pilot: hosting and email

Everything runs on **one Linux server** with Docker, set up by `infra/production/`:

```
internet ──443──▶ proxy (Caddy, automatic HTTPS)
                    ├─ example.org            → web  (public Russian site, badge, Telegram Mini App)
                    ├─ admin.example.org      → admin dashboard (static) + /api → api
                    └─ partners.example.org   → partner portal (static) + /api → api
                  api  (NestJS; runs database migrations on start)
                  bot  (Telegram long polling)
                  db   (PostgreSQL 16, data in a Docker volume)
                  uploads volume (operators' licence files, encrypted with DOCUMENT_ENCRYPTION_KEY)
                  backup (nightly pg_dump + uploads archive into infra/production/backups, kept 14 days)
```

Email goes out over SMTP through whichever email provider you choose. Nothing is tied to one host
or provider, so moving later means copying the database dump and changing DNS.

## 1. Choose where to host (read this first)

Most of our visitors are in Russia, and since June 2025 Russian ISPs have been slowing or blocking
sites served from large Western clouds and CDNs. Cloudflare reported that
[Russian ISPs cut its traffic after the first 16 KB](https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/),
which makes pages unusable, and named Hetzner, DigitalOcean and OVH as also affected
([heise](https://www.heise.de/en/news/The-16-Kbyte-trick-Russian-providers-block-foreign-content-again-10465087.html)).
This seems to depend on the provider's IP ranges, and it changes over time.

So:

- **Don't put the site behind Cloudflare** or another big CDN. The setup here doesn't need one: Caddy
  handles HTTPS and compression.
- **Pick a VPS provider and test it from Russia before you commit.** Rent the smallest server for
  a day, run `docker compose up` (step 4), and ask a contact in Russia to open the site on home internet
  and on mobile data. Check that the operator pages load completely, not only the top of the page.
  Online checkers with Russian test points, such as check-host.net, are a quick first test. They are
  not a substitute for a real person's connection.
- Also check it loads quickly from Uganda, Kenya and Tanzania, for operators and staff.
- **Server size:** 2 vCPU, 4 GB RAM and 40 GB SSD is enough for the pilot. Use Ubuntu 24.04 LTS.

This keeps decision B5.2: we are not hosting in Russia for now. The setup is provider-neutral, so if the
pilot or legal advice says a Russian host is needed, the same setup runs there unchanged.

### Russian host or foreign host?

| | Host inside Russia | Host outside Russia |
|---|---|---|
| **Paying for it** | Russian providers take Russian cards (Mir) and rouble transfers. A company outside Russia usually **cannot** pay them with a foreign card: foreign Visa/Mastercard cards don't work in Russia. Expect to need a rouble account or an intermediary. | Foreign providers take foreign cards. **Cards issued by Russian banks don't work for payments abroad** (since 2022), and most foreign providers don't accept Mir. Pay from the company's non-Russian account. |
| **Speed for travellers in Russia** | Fast, and not affected by the throttling of foreign networks. Somewhat slower for operators and staff in East Africa, but fine for a portal. | Depends on the provider: some large Western clouds and CDNs are throttled or blocked in Russia (see above). **Test from inside Russia before committing.** |
| **Where Russian travellers' personal data is stored** | In Russia. That is what Russian data law expects (see below). Russian authorities can demand access to data held there. | Outside Russia. That may conflict with Russian data law (see below). |

**Needs legal advice before the pilot collects real travellers' data (do not guess these):**

- **Russian personal-data law (152-FZ).** It requires personal data of Russian citizens to be first collected
  and stored in databases located in Russia. Does it apply to us? We are a company outside Russia, but the site
  is in Russian and aimed at Russian travellers. The regulator (Roskomnadzor) can block websites that break
  this rule; LinkedIn was blocked in Russia in 2016 for this reason.
- **Notifications to the regulator.** Do we have to register as a personal-data operator with Roskomnadzor,
  and notify it before transferring data out of Russia?
- **Sanctions.** Does our company's country, or a provider's, allow us to pay a Russian hosting company, or
  allow a provider to serve us? This also decides which email providers we may use.
- **A split setup.** Keep travellers' personal data on a Russian server and everything else abroad. The data
  model keeps that data in separate tables (`telegram_users`, `inquiries`, `inquiry_replies`, `reviews`,
  `review_invites`), so this is a bounded piece of build work if the lawyer recommends it. It is not built.

What we keep about travellers is deliberately small: Telegram ID and name, their questions and our answers, and
review texts. Nothing about passports or payments.

## 2. Domain and DNS

Buy the domain. Then, at your DNS provider, create **A records** pointing at the server's IP for:

| Name | Purpose |
|---|---|
| `example.org` | public site |
| `www.example.org` | redirects to the site |
| `admin.example.org` | staff dashboard |
| `partners.example.org` | operator and DMC portal |

HTTPS certificates are issued automatically (Let's Encrypt) the first time each address is opened,
once DNS points at the server.

## 3. Email

Choose any provider that offers **SMTP** and lets you send from your own domain. Check two things
before choosing:

1. Your account (registered where your company is) is allowed to send to Russian addresses.
2. Mail actually reaches **mail.ru, yandex.ru and gmail.com** inboxes. Test this in step 6.

At the provider:

1. Add your domain. Use a subdomain such as `mail.example.org` if the provider suggests it.
2. Add the **SPF, DKIM and DMARC** DNS records (exact records below), and wait until the provider shows
   them as verified. Without these, mail.ru, Yandex and Gmail put the emails in spam or refuse them.
3. Create SMTP credentials and note the host, port, user and password.

Then fill these in `infra/production/.env` (step 4):

| Setting | Example | Purpose |
|---|---|---|
| `SMTP_URL` | `smtps://USER:PASSWORD@smtp.provider.com:465` | where mail is sent; URL-encode special characters in the password |
| `MAIL_FROM` | `no-reply@example.org` | sender address, on the verified domain |
| `MAIL_FROM_NAME` | `Проверено: Африка` | sender name shown in inboxes |
| `MAIL_REPLY_TO` | `partners@example.org` | a real mailbox your team reads; partners' replies go here |
| `STAFF_EMAILS` | `ops@example.org` | staff alerts, comma-separated |

### DNS records for email

Replace `example.org` with the domain in `MAIL_FROM`. The provider's own values go where the angle brackets
are; its dashboard shows them. Add the records at your DNS provider (the same place as the A records in §2).

| Type | Name (host) | Value | Notes |
|---|---|---|---|
| TXT | `example.org` (often written `@`) | `v=spf1 include:<provider's SPF domain> ~all` | **SPF.** Only **one** SPF record per domain. If you already have one (e.g. for your own mailboxes), add the `include:` to it instead of making a second: `v=spf1 include:<mailbox host> include:<provider> ~all`. |
| TXT or CNAME | `<selector>._domainkey.example.org` | TXT: `v=DKIM1; k=rsa; p=<public key from the provider>`, or CNAME to the provider's key host | **DKIM.** The provider gives the selector (e.g. `s1`) and the key. Copy them exactly; long TXT values may need splitting into 255-character pieces, which most DNS panels do for you. |
| TXT | `_dmarc.example.org` | `v=DMARC1; p=none; rua=mailto:dmarc@example.org; adkim=r; aspf=r` | **DMARC.** Start with `p=none` and read the reports sent to `rua` for 2–4 weeks. When only your provider appears as a sender, change to `p=quarantine`, later `p=reject`. |
| CNAME | e.g. `bounces.example.org` → `<provider host>` | | **Return path** (only if the provider offers a custom one). It makes SPF "align" with your domain, which DMARC rewards. |
| MX | `example.org` → your mailbox host | | Only for **receiving** mail at `MAIL_REPLY_TO` (e.g. `partners@example.org`). Sending doesn't need it, but partners' replies do. |

Check what is published (on any computer with `dig`, or an online "DNS lookup" tool):

```bash
dig +short TXT example.org            # one line starting v=spf1
dig +short TXT _dmarc.example.org     # v=DMARC1; …
dig +short TXT s1._domainkey.example.org
```

The free postmaster dashboards of Gmail (Postmaster Tools), Mail.ru (Postmaster) and Yandex show how they
rate your domain once you send regularly. Register the domain with each.

### Test delivery

On the server, after `docker compose up -d`:

```bash
docker compose exec api node dist/cli/send-test-email.js you@mail.ru you@yandex.ru you@gmail.com --dkim-selector=<selector>
```

The script first checks the SPF, DMARC and DKIM records of the `MAIL_FROM` domain. It then sends one test
message per address and prints `OK` (the provider accepted it) or `FAIL` with the reason; it exits with code 1
if any send failed. "Accepted" isn't "delivered": **open each mailbox** and find "Delivery test <number>" in the
inbox. If it landed in spam:
- check the three records again;
- wait a day after first adding DKIM;
- mark the message "Not spam".

Repeat until all three reach the inbox.

**What gets emailed**

| When | Who | Language |
|---|---|---|
| Staff create a portal login, or click "New password link" | the partner (staff also see the link) | EN for operators, RU for DMCs |
| "Forgot your password?" on the portal | the partner, if the login exists (at most once every 5 minutes) | EN / RU |
| A Russian DMC applies | staff, plus an acknowledgement to the DMC | EN / RU |
| Staff approve, reject or suspend a DMC | the DMC | RU |
| A traveller asks a question in the Mini App | the operator's logins (answer in the portal Inbox); staff if the operator has no login yet | EN |
| A DMC requests a quote | the operator's logins; staff if the operator has no login yet | EN |
| An operator quotes or declines | the DMC | RU |
| A DMC or operator reports a quote as booked | the other side, to confirm | RU to DMCs, EN to operators |
| The two booking reports disagree | staff | EN |
| A DMC asks to join a fam trip | staff | EN |
| Staff add an operator to a fam trip, or confirm a DMC's place | that operator / DMC | EN / RU |

If an email fails, the action it belongs to still goes through and the API logs the error. Login links
are still shown to staff in the dashboard, so they can be passed on another way. Without `SMTP_URL`,
emails are not sent: they are only written to the API log. That is how development works.

## 4. Install

On the server, as a user who can run `sudo`:

```bash
# Docker (official convenience script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

git clone https://github.com/derricksparks/tourists_trust_app.git
cd tourists_trust_app/infra/production
cp .env.example .env
nano .env          # fill in every value; secrets with: openssl rand -base64 48 | tr -d '/+=' | cut -c1-48
docker compose up -d --build
```

The first build takes about 5–10 minutes. Then check that everything is running:

```bash
docker compose ps                 # all services "running"; api "healthy"
docker compose logs api | tail    # look for "API listening" and any "Warning:" lines
```

The API refuses to start in production if a secret is missing or too short, or if an address isn't
`https://`. `DOCUMENT_ENCRYPTION_KEY` encrypts the licence and registration files operators upload. **Keep a
copy of it outside the server** (e.g. in your password manager): without it, those files and their backups
can't be opened. It warns, but still starts, if Telegram, email or `STAFF_EMAILS` is not set up.

**Create the first staff login.** This also adds the country list. Never run the demo seed on this
server; it refuses to in production anyway.

```bash
docker compose exec api node dist/cli/setup.js you@example.org "Your Name"
# prints a one-time password; sign in at https://admin.example.org
docker compose exec api node dist/cli/setup.js colleague@example.org "Name" MODERATOR    # or CONTENT_EDITOR
```

Running it again for an existing email resets that person's password. Use this if a staff member is
locked out.

## 5. Telegram

1. In [@BotFather](https://t.me/BotFather), create the production bot. Put its token in
   `TELEGRAM_BOT_TOKEN` and its username (without @) in `TELEGRAM_BOT_USERNAME`.
2. In BotFather, set the Mini App URL to `https://example.org/tg`.
3. Apply the change with `docker compose up -d`. Only one copy of the bot may poll Telegram at a time, so
   stop any test copy using the same token.

## 6. Before inviting partners

- [ ] Site, admin and portal open over HTTPS from Russia (home and mobile) and from East Africa.
- [ ] Run the delivery test in §3 against addresses you control at **mail.ru**, **yandex.ru** and
      **gmail.com** until all three land in the inbox. Then create a portal login for one of them and check
      the link in the email works.
- [ ] Use "Forgot your password?" on the portal once.
- [ ] Apply as a test DMC at `https://partners.example.org/signup`. Check staff get the email, then
      reject the test DMC.
- [ ] In Telegram, open the bot, start the Mini App and send a test question. It should appear under
      Inquiries.
- [ ] Paste one operator's badge code into a test page on another site and check it shows "Verified".
- [ ] Countries (dashboard → Countries): check each destination's licensing authority and add the link to its
      licence register, so reviewers can check licence numbers.
- [ ] Tell operators where to apply: `https://partners.example.org/apply`. Their applications arrive in the
      approval queue, and staff are emailed.
- [ ] Replace the placeholder content: site name, visa guides (still drafts until checked against
      official sources) and insurer details. The site needs a privacy policy before collecting
      travellers' contacts.
- [ ] For every visa guide and insurer, fill in **Source checked** and **Verified on** after checking the
      facts. Until both are filled in, the public page shows a red "Ещё не проверено" notice.
- [ ] Dashboard → **Settings** (super admin): paste your lawyer's wording into the visa and insurance
      disclaimers. Until then the site shows standard wording that no lawyer has reviewed.
- [ ] Settings → **Licence copies**: set how long operators' licence copies are kept (ask your lawyer). Files
      past that period are listed there; nothing is deleted automatically, so check the list monthly.
- [ ] Set up an uptime monitor (any free service) on `https://admin.example.org/api/health`. It answers 200
      with `"status":"ok"`, the uptime and the database response time, or 503 when the database is down.
      Optional: start with `APP_VERSION=$(git rev-parse --short HEAD) docker compose up -d --build` to see the
      running version there.
- [ ] Run the restore drill (§8) once, so you know backups work.

## 7. Day to day

**Update to a new version.** Database migrations run automatically when the API starts.

```bash
cd tourists_trust_app && git pull
cd infra/production && docker compose up -d --build
```

**Logs:** `docker compose logs -f api` (or `web`, `bot`, `proxy`).

**Restart one part:** `docker compose restart api`.

## 8. Backups

The `backup` service writes `infra/production/backups/ttp-<date>.dump` (database) and
`uploads-<date>.tar.gz` (operators' documents, still encrypted) every 24 hours, plus one set when it starts,
and deletes files older than 14 days. **They are on the same server**, so also:

- turn on your VPS provider's automatic server backups or snapshots, if it offers them; and
- copy the dumps somewhere else regularly, e.g. from your own computer:
  `rsync -av user@server:tourists_trust_app/infra/production/backups/ ./ttp-backups/`

**Restore drill (safe, do it monthly).** This restores the newest backup into a scratch database, checks
the tables and row counts, then deletes the scratch database. Live data is not touched.

```bash
cd tourists_trust_app/infra/production
docker compose run --rm --no-deps --entrypoint sh backup /restore-check.sh
# or a specific file: … /restore-check.sh /backups/ttp-2026-10-09T0300.dump
```

It ends with `PASS: restore check passed`, or `FAIL: …` and a non-zero exit code.

**Restoring a backup for real** (replaces all live data):

```bash
cd tourists_trust_app/infra/production
./restore.sh backups/ttp-2026-10-09T0300.dump backups/uploads-2026-10-09T0300.tar.gz --yes
```

The script:
1. Refuses to run without `--yes`, or if the database container isn't running.
2. Runs the drill on that file first.
3. Saves the current database to `backups/before-restore-<time>.dump`.
4. Stops the app, restores the database, and restores the documents if you gave the uploads file. Restoring
   documents needs the same `DOCUMENT_ENCRYPTION_KEY` in `.env` as when they were saved.
5. Starts the app and waits until `/health` is OK.

To restore only the database and leave the app running, use `--database-only` (don't give an uploads file).
To restore a copy you kept off the server, first copy it into `infra/production/backups/`.

## What was tested

Pilot round (12 October 2026):
- Operator notifications go out by email whatever an operator chooses; Telegram and WhatsApp are listed
  in the portal as "coming later".
- Content safety (verification notices, disclaimers, document deletion and retention) has automated API and
  browser tests.
- `restore-check.sh` passed on a real backup, and failed correctly on a broken file and on an empty
  folder. It is also an automated test.
- `restore.sh --database-only` restored a damaged database (18 of 18 operators and reviews back), kept the
  safety copy, refused to run without `--yes`, refused when the database wasn't running, and refused a file
  outside `backups/`. This ran on the production compose file with the `db` and `backup` containers.
- **Not yet run end to end:** the full app stop/start and the documents restore. The app images can't be built
  in that environment. Run it once on your server or laptop.
- The delivery-test script was tested against a stand-in mail server (accepted, refused and invalid
  addresses) and against stand-in DNS records.

These checks were run while building this setup:

- The production commands ran against a fresh database: migrations, `cli/setup.js`, the API in
  production mode, and the built site.
- The Caddy configuration was validated and served all three domains over HTTPS (local test
  certificates): routing, headers and SPA fallback.
- Real SMTP delivery went to a test mailbox, including the Russian sender name.
- A browser signed in to the admin and portal through the proxy.
- The backup script ran, and a dump was restored into a new database.

The Docker images themselves could not be built in that environment (no internet inside image builds
there). CI builds them on every push (the `docker` job), and they are built for real on the server in
step 4.
