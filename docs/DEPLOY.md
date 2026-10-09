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
                  backup (nightly pg_dump into infra/production/backups, kept 14 days)
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

This keeps decision B5.2: we are not hosting in Russia, so no Russian-hosting obligations apply yet.
If the pilot shows a Russian host is needed, this same setup runs there unchanged.

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
2. Add the **SPF, DKIM and DMARC** DNS records it gives you, and wait until it shows them as verified.
   Without these, Russian mailboxes put the emails in spam.
3. Create SMTP credentials and note the host, port, user and password.

Then fill these in `infra/production/.env` (step 4):

| Setting | Example | Purpose |
|---|---|---|
| `SMTP_URL` | `smtps://USER:PASSWORD@smtp.provider.com:465` | where mail is sent; URL-encode special characters in the password |
| `MAIL_FROM` | `no-reply@example.org` | sender address, on the verified domain |
| `MAIL_FROM_NAME` | `Проверено: Африка` | sender name shown in inboxes |
| `MAIL_REPLY_TO` | `partners@example.org` | a real mailbox your team reads; partners' replies go here |
| `STAFF_EMAILS` | `ops@example.org` | staff alerts, comma-separated |

**What gets emailed**

| When | Who | Language |
|---|---|---|
| Staff create a portal login, or click "New password link" | the partner (staff also see the link) | EN for operators, RU for DMCs |
| "Forgot your password?" on the portal | the partner, if the login exists (at most once every 5 minutes) | EN / RU |
| A Russian DMC applies | staff, plus an acknowledgement to the DMC | EN / RU |
| Staff approve, reject or suspend a DMC | the DMC | RU |
| A DMC requests a quote | the operator's logins; staff if the operator has no login yet | EN |
| An operator quotes or declines | the DMC | RU |
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
`https://`. It warns, but still starts, if Telegram, email or `STAFF_EMAILS` is not set up.

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
- [ ] In the dashboard, create a portal login for an address you control at **mail.ru**, one at
      **yandex.ru** and one at **gmail.com**. Check each email arrives in the inbox, not spam, and
      that the link works.
- [ ] Use "Forgot your password?" on the portal once.
- [ ] Apply as a test DMC at `https://partners.example.org/signup`. Check staff get the email, then
      reject the test DMC.
- [ ] In Telegram, open the bot, start the Mini App and send a test question. It should appear under
      Inquiries.
- [ ] Paste one operator's badge code into a test page on another site and check it shows "Verified".
- [ ] Replace the placeholder content: site name, visa guides (still drafts until checked against
      official sources) and insurer details. The site needs a privacy policy before collecting
      travellers' contacts.
- [ ] Set up an uptime monitor (any free service) on `https://admin.example.org/api/health`.
- [ ] Do a restore drill (below) once, so you know it works.

## 7. Day to day

**Update to a new version.** Database migrations run automatically when the API starts.

```bash
cd tourists_trust_app && git pull
cd infra/production && docker compose up -d --build
```

**Logs:** `docker compose logs -f api` (or `web`, `bot`, `proxy`).

**Restart one part:** `docker compose restart api`.

## 8. Backups

The `backup` service writes `infra/production/backups/ttp-<date>.dump` every 24 hours, plus one when
it starts, and deletes dumps older than 14 days. **They are on the same server**, so also:

- turn on your VPS provider's automatic server backups or snapshots, if it offers them; and
- copy the dumps somewhere else regularly, e.g. from your own computer:
  `rsync -av user@server:tourists_trust_app/infra/production/backups/ ./ttp-backups/`

**Restoring a backup** (replaces all data):

```bash
cd tourists_trust_app/infra/production
docker compose stop api web bot
docker compose exec db dropdb -U ttp ttp
docker compose exec db createdb -U ttp ttp
docker compose exec -T db pg_restore -U ttp -d ttp --no-owner < backups/ttp-2026-10-09T0300.dump
docker compose start api web bot
```

## What was tested

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
