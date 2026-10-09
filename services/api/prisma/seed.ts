/**
 * Development fixture data. Every company, person and insurer here is FICTIONAL — names are
 * invented and marked "(demo)". Visa content is placeholder text left in DRAFT until staff
 * verify it against the official sources.
 *
 * Wipes all application tables first, so never run against production.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/common/prisma.service';
import { REFERENCE_COUNTRIES } from '../src/common/countries';
import { ScoringService } from '../src/scoring/scoring.service';
import { DocumentStore } from '../src/storage/document-store';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { rmSync } from 'fs';
import { join, resolve } from 'path';

const prisma = new PrismaClient();
const token = () => randomBytes(32).toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** A one-page PDF showing one line of text (demo documents). */
function demoPdf(text: string): Buffer {
  const safe = text.replace(/[()\\]/g, '');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${31 + safe.length} >>\nstream\nBT /F1 14 Tf 60 780 Td (${safe}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** Demo package-feed key (development only). */
const DEMO_FEED_KEY = 'ttp_demo_0000000000000000000000000000000000000000';
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function wipe() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
  // Their uploaded files go too (development folder only; the seed never runs in production).
  rmSync(join(resolve(process.env.UPLOAD_DIR ?? 'uploads'), 'documents'), { recursive: true, force: true });
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  await wipe();

  // ── Reference data ──
  await prisma.country.createMany({
    data: [
      ...REFERENCE_COUNTRIES,
      // Added by staff but not switched on yet: shows the "more countries" flow (Phase 4).
      { code: 'ZM', nameEn: 'Zambia', nameRu: 'Замбия', nameRuIn: 'в Замбии', active: false },
    ],
  });

  // ── Staff ──
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'change-me';
  const admin = await prisma.adminUser.create({
    data: { name: 'Demo Super Admin', email: adminEmail, passwordHash: await bcrypt.hash(adminPassword, 12), role: 'SUPER_ADMIN' },
  });
  const moderator = await prisma.adminUser.create({
    data: { name: 'Demo Moderator', email: 'moderator@example.com', passwordHash: await bcrypt.hash(adminPassword, 12), role: 'MODERATOR' },
  });
  await prisma.adminUser.create({
    data: { name: 'Demo Editor', email: 'editor@example.com', passwordHash: await bcrypt.hash(adminPassword, 12), role: 'CONTENT_EDITOR' },
  });

  // ── Operators: a mix of statuses so the approval queue has work in it ──
  const approvedAt = new Date('2026-09-01T10:00:00Z');
  const op = (o: {
    slug: string; name: string; countryCode: string; licensingAuthority: string; status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'FLAGGED' | 'SUSPENDED';
    statusReason?: string; descriptionRu?: string; year?: number; video?: string; badgeToken?: string;
  }) =>
    prisma.operator.create({
      data: {
        slug: o.slug,
        name: o.name,
        countryCode: o.countryCode,
        businessRegNumber: `DEMO-REG-${o.slug.toUpperCase().slice(0, 12)}`,
        tourismBoardLicense: `DEMO-LIC-${Math.floor(1000 + Math.random() * 9000)}`,
        licensingAuthority: o.licensingAuthority,
        address: `Demo address, ${o.countryCode}`,
        yearEstablished: o.year,
        referenceContactName: 'Demo Reference',
        referenceContactInfo: 'reference@example.com',
        websiteUrl: `https://${o.slug}.example.com`,
        email: `info@${o.slug}.example.com`,
        phone: '+000 000 000 000',
        descriptionRu: o.descriptionRu,
        descriptionEn: `${o.name} is a fictional operator used for development.`,
        status: o.status,
        statusReason: o.statusReason,
        verificationVideoUrl: o.video,
        badgeToken: o.badgeToken ?? token(),
        submittedAt: o.status === 'DRAFT' ? null : new Date(),
        ...(o.status === 'APPROVED' || o.status === 'SUSPENDED' ? { approvedAt, approvedById: moderator.id } : {}),
      },
    });

  const pearl = await op({ slug: 'pearl-gorilla-treks-demo-ug', name: 'Pearl Gorilla Treks (demo)', countryCode: 'UG', licensingAuthority: 'Uganda Tourism Board', status: 'APPROVED', year: 2011, video: 'https://www.youtube.com/watch?v=demo1', badgeToken: 'demo-badge-pearl-gorilla-treks', descriptionRu: 'Трекинг к горным гориллам в Бвинди и сафари в Королеве Елизавете. (демо)' });
  const kilima = await op({ slug: 'kilima-horizon-safaris-demo-tz', name: 'Kilima Horizon Safaris (demo)', countryCode: 'TZ', licensingAuthority: 'Tanzania Tourist Agency Licensing Authority (TALA)', status: 'APPROVED', year: 2008, video: 'https://www.youtube.com/watch?v=demo2', descriptionRu: 'Сафари в Серенгети и Нгоронгоро, восхождения на Килиманджаро. (демо)' });
  const savanna = await op({ slug: 'savanna-line-tours-demo-ke', name: 'Savanna Line Tours (demo)', countryCode: 'KE', licensingAuthority: 'Tourism Regulatory Authority (Kenya)', status: 'APPROVED', year: 2015, descriptionRu: 'Масаи-Мара, Амбосели и пляжи Диани. (демо)' });
  await op({ slug: 'zanzi-spice-journeys-demo-tz', name: 'Zanzi Spice Journeys (demo)', countryCode: 'TZ', licensingAuthority: 'Tanzania Tourist Agency Licensing Authority (TALA)', status: 'PENDING', year: 2019 });
  await op({ slug: 'nile-source-adventures-demo-ug', name: 'Nile Source Adventures (demo)', countryCode: 'UG', licensingAuthority: 'Uganda Tourism Board', status: 'PENDING', year: 2021 });
  const rift = await op({ slug: 'rift-valley-trails-demo-ke', name: 'Rift Valley Trails (demo)', countryCode: 'KE', licensingAuthority: 'Tourism Regulatory Authority (Kenya)', status: 'FLAGGED', statusReason: 'Licence number does not match the registry; asked operator for a copy.' });
  await op({ slug: 'quick-safari-deals-demo-ke', name: 'Quick Safari Deals (demo)', countryCode: 'KE', licensingAuthority: 'Tourism Regulatory Authority (Kenya)', status: 'REJECTED', statusReason: 'No valid tourism licence provided.' });
  await op({ slug: 'lake-mburo-camps-demo-ug', name: 'Lake Mburo Camps (demo)', countryCode: 'UG', licensingAuthority: 'Uganda Tourism Board', status: 'SUSPENDED', statusReason: 'Licence expired; awaiting renewal.', year: 2012, badgeToken: 'demo-badge-lake-mburo-camps' });


  // Phase 1 needs 10–15 live listings: nine more approved operators, each with one package and reviews.
  const UTB = 'Uganda Tourism Board';
  const TALA = 'Tanzania Tourist Agency Licensing Authority (TALA)';
  const TRA = 'Tourism Regulatory Authority (Kenya)';
  const more: { slug: string; name: string; cc: 'UG' | 'TZ' | 'KE'; auth: string; year: number; ru: string; pkg: [string, string, number, number]; ratings: number[] }[] = [
    { slug: 'kibale-canopy-walks-demo-ug', name: 'Kibale Canopy Walks (demo)', cc: 'UG', auth: UTB, year: 2014, ru: 'Шимпанзе в Кибале, озёра кратеров и чайные плантации Форт-Портала. (демо)', pkg: ['Кибале: шимпанзе и кратерные озёра', 'Kibale chimps & crater lakes', 3, 1350], ratings: [5, 4] },
    { slug: 'murchison-river-safaris-demo-ug', name: 'Murchison River Safaris (demo)', cc: 'UG', auth: UTB, year: 2009, ru: 'Водопады Мерчисон, круизы по Нилу и сафари в северной Уганде. (демо)', pkg: ['Мерчисон-Фолс: Нил и саванна', 'Murchison Falls river & savanna', 4, 1180], ratings: [5] },
    { slug: 'rwenzori-peak-guides-demo-ug', name: 'Rwenzori Peak Guides (demo)', cc: 'UG', auth: UTB, year: 2017, ru: 'Треккинг в горах Рувензори с сертифицированными гидами. (демо)', pkg: ['Рувензори: 7-дневный трек', 'Rwenzori 7-day trek', 7, 1990], ratings: [4, 4, 5] },
    { slug: 'serengeti-dust-expeditions-demo-tz', name: 'Serengeti Dust Expeditions (demo)', cc: 'TZ', auth: TALA, year: 2006, ru: 'Великая миграция в Серенгети, кемпинги и лоджи северного круга. (демо)', pkg: ['Великая миграция, 7 дней', 'Great Migration, 7 days', 7, 3950], ratings: [5, 5] },
    { slug: 'zanzibar-dhow-coast-demo-tz', name: 'Zanzibar Dhow Coast (demo)', cc: 'TZ', auth: TALA, year: 2012, ru: 'Стоун-Таун, плантации специй и морские прогулки на доу по Занзибару. (демо)', pkg: ['Занзибар: Стоун-Таун и острова', 'Zanzibar Stone Town & islands', 5, 890], ratings: [4] },
    { slug: 'kilimanjaro-summit-crew-demo-tz', name: 'Kilimanjaro Summit Crew (demo)', cc: 'TZ', auth: TALA, year: 2010, ru: 'Восхождения на Килиманджаро по маршрутам Мачаме и Лемошо. (демо)', pkg: ['Килиманджаро, маршрут Мачаме', 'Kilimanjaro Machame route', 7, 2150], ratings: [5, 4, 4] },
    { slug: 'amboseli-elephant-camps-demo-ke', name: 'Amboseli Elephant Camps (demo)', cc: 'KE', auth: TRA, year: 2013, ru: 'Слоны Амбосели на фоне Килиманджаро, палаточные лагеря. (демо)', pkg: ['Амбосели: слоны и Килиманджаро', 'Amboseli elephants', 3, 1060], ratings: [5] },
    { slug: 'diani-reef-escapes-demo-ke', name: 'Diani Reef Escapes (demo)', cc: 'KE', auth: TRA, year: 2016, ru: 'Пляжи Диани, снорклинг в морском парке Кисите и сафари в Цаво. (демо)', pkg: ['Цаво и пляжи Диани', 'Tsavo & Diani beach', 6, 1420], ratings: [4, 5] },
    { slug: 'samburu-north-trails-demo-ke', name: 'Samburu North Trails (demo)', cc: 'KE', auth: TRA, year: 2018, ru: 'Северная Кения: Самбуру, Ол-Педжета и культура самбуру. (демо)', pkg: ['Самбуру и Ол-Педжета', 'Samburu & Ol Pejeta', 5, 2280], ratings: [] },
  ];
  const approvedMore = [];
  for (const [i, m] of more.entries()) {
    const o = await op({ slug: m.slug, name: m.name, countryCode: m.cc, licensingAuthority: m.auth, status: 'APPROVED', year: m.year, descriptionRu: m.ru, video: i % 2 ? undefined : `https://www.youtube.com/watch?v=demo${i + 10}` });
    approvedMore.push(o);
    const [titleRu, title, days, price] = m.pkg;
    const p = await prisma.package.create({
      data: {
        operatorId: o.id, slug: `${m.slug.replace(/-demo-..$/, '')}-${days}d-demo`, title: `${title} (demo)`, titleRu: `${titleRu} (демо)`,
        descriptionRu: `${m.ru}`, countryCode: m.cc, durationDays: days, price, currency: 'USD', capacity: 6,
        inclusions: ['transport', 'accommodation', 'guide'], exclusions: ['international flights', 'visa', 'insurance'], status: 'PUBLISHED',
        dateRanges: { create: [{ startDate: day('2027-02-01'), endDate: day(`2027-02-${String(days).padStart(2, '0')}`) }, { startDate: day('2027-06-10'), endDate: day(`2027-06-${String(9 + days).padStart(2, '0')}`) }] },
      },
    });
    for (const [j, rating] of m.ratings.entries()) {
      const invite = await prisma.reviewInvite.create({
        data: { tokenHash: sha256(`demo-invite-${m.slug}-${j}`), operatorId: o.id, packageId: p.id, recipientName: `Демо Турист ${j + 1}`, recipientContact: `t${j}@example.com`,
          tripDate: day('2026-07-15'), issuedById: admin.id, expiresAt: new Date('2026-12-31T00:00:00Z'), usedAt: new Date('2026-08-01T00:00:00Z') },
      });
      await prisma.review.create({
        data: { operatorId: o.id, packageId: p.id, inviteId: invite.id, authorName: ['Ирина (демо)', 'Дмитрий (демо)', 'Мария (демо)'][j], rating,
          bodyRu: rating === 5 ? 'Всё прошло как обещали, гид встретил вовремя. (демо)' : 'Хорошая поездка, но жильё попроще, чем на фото. (демо)',
          tripDate: day('2026-07-15'), status: 'PUBLISHED', moderatedById: moderator.id, moderatedAt: new Date('2026-08-03T00:00:00Z') },
      });
    }
  }

  await prisma.auditLog.createMany({
    data: [pearl, kilima, savanna, ...approvedMore].map((o) => ({
      actorAdminId: moderator.id, action: 'operator.approve', entityType: 'operator', entityId: o.id, metadata: { to: 'APPROVED' }, createdAt: approvedAt,
    })),
  });

  // Real (tiny, fictional) PDFs, encrypted into UPLOAD_DIR like uploads, so "Open" works in the dashboard.
  const store = new DocumentStore();
  const demoDoc = async (operatorId: string, name: string, type: 'TOURISM_LICENSE' | 'BUSINESS_REGISTRATION', reviewed?: string) => {
    const pdf = demoPdf(`${type === 'TOURISM_LICENSE' ? 'Tourism licence' : 'Business registration'} - ${name} - FICTIONAL DEMO DOCUMENT`);
    await prisma.operatorDocument.create({
      data: {
        operatorId, type, storageKey: await store.put(`documents/${operatorId}`, pdf), originalFilename: `${type === 'TOURISM_LICENSE' ? 'licence' : 'registration'}-demo.pdf`,
        contentType: 'application/pdf', sizeBytes: pdf.length,
        ...(reviewed && { reviewedById: moderator.id, reviewedAt: approvedAt, reviewNotes: reviewed }),
      },
    });
  };
  await demoDoc(pearl.id, 'Pearl Gorilla Treks', 'TOURISM_LICENSE', 'Matches UTB registry (demo).');
  for (const o of await prisma.operator.findMany({ where: { status: { in: ['PENDING', 'FLAGGED'] } } })) {
    await demoDoc(o.id, o.name, 'TOURISM_LICENSE');
    await demoDoc(o.id, o.name, 'BUSINESS_REGISTRATION');
  }
  await prisma.media.create({
    data: { operatorId: pearl.id, kind: 'VIDEO', externalUrl: 'https://www.youtube.com/watch?v=demo1', captionRu: 'Наш офис и автомобили (демо)', status: 'APPROVED' },
  });

  // ── Packages ──
  const gorilla = await prisma.package.create({
    data: {
      operatorId: pearl.id, slug: 'bwindi-gorilla-trek-4d-demo', title: 'Bwindi Gorilla Trek, 4 days (demo)', titleRu: 'Трекинг к гориллам в Бвинди, 4 дня (демо)',
      descriptionRu: 'Встреча в Энтеббе, переезд в Бвинди, трекинг с рейнджерами, возвращение. (демо)', descriptionEn: 'Fictional package for development.',
      countryCode: 'UG', durationDays: 4, price: 2450, currency: 'USD', priceBasis: 'PER_PERSON', capacity: 6,
      inclusions: ['gorilla permit', 'transport', 'accommodation', 'meals'], exclusions: ['international flights', 'visa', 'insurance'], status: 'PUBLISHED',
      externalRef: 'PGT-BWINDI-4',
      dateRanges: { create: [{ startDate: day('2027-01-10'), endDate: day('2027-01-13') }, { startDate: day('2027-02-14'), endDate: day('2027-02-17'), capacity: 4 }] },
    },
  });
  const serengeti = await prisma.package.create({
    data: {
      operatorId: kilima.id, slug: 'serengeti-ngorongoro-6d-demo', title: 'Serengeti & Ngorongoro, 6 days (demo)', titleRu: 'Серенгети и Нгоронгоро, 6 дней (демо)',
      descriptionRu: 'Классическое сафари на северном круге Танзании. (демо)', countryCode: 'TZ', durationDays: 6, price: 3100, currency: 'USD', priceBasis: 'PER_PERSON', capacity: 7,
      inclusions: ['park fees', '4x4 vehicle', 'lodges'], exclusions: ['flights', 'tips'], status: 'PUBLISHED',
      dateRanges: { create: [{ startDate: day('2027-07-01'), endDate: day('2027-07-06') }] },
    },
  });
  await prisma.package.create({
    data: {
      operatorId: savanna.id, slug: 'masai-mara-3d-demo', title: 'Masai Mara, 3 days (demo)', titleRu: 'Масаи-Мара, 3 дня (демо)', countryCode: 'KE', durationDays: 3,
      price: 980, currency: 'USD', capacity: 6, inclusions: ['park fees', 'transport'], exclusions: ['flights'], status: 'DRAFT',
    },
  });

  // ── Reviews: only through invite links ──
  // The open one is a working demo link: SITE_URL/review/demo-review-link-kilima-horizon-0000000001
  const demoInviteTokens = ['demo-review-link-pearl-gorilla-0000000001', 'demo-review-link-pearl-gorilla-0000000002', 'demo-review-link-kilima-horizon-0000000001'];
  const [inv1, inv2] = await Promise.all(
    demoInviteTokens.map((t, i) =>
      prisma.reviewInvite.create({
        data: {
          tokenHash: sha256(t), operatorId: i < 2 ? pearl.id : kilima.id, packageId: i < 2 ? gorilla.id : serengeti.id,
          recipientName: `Демо Путешественник ${i + 1}`, recipientContact: `traveller${i + 1}@example.com`, tripDate: day('2026-08-20'),
          issuedById: admin.id, expiresAt: new Date('2026-12-31T00:00:00Z'), usedAt: i < 2 ? new Date('2026-09-05T00:00:00Z') : null,
        },
      }),
    ),
  );
  await prisma.review.create({
    data: {
      operatorId: pearl.id, packageId: gorilla.id, inviteId: inv1.id, authorName: 'Анна (демо)', rating: 5, ratingGuide: 5, ratingVehicle: 4, ratingAccommodation: 5, ratingValue: 4,
      bodyRu: 'Отличная организация, гид говорил по-английски медленно и понятно. (демо)', tripDate: day('2026-08-20'), status: 'PUBLISHED', moderatedById: moderator.id, moderatedAt: new Date('2026-09-06T00:00:00Z'),
    },
  });
  await prisma.review.create({
    data: { operatorId: pearl.id, packageId: gorilla.id, inviteId: inv2.id, authorName: 'Сергей (демо)', rating: 4, bodyRu: 'Всё хорошо, но дорога была долгой. (демо)', tripDate: day('2026-08-20'), status: 'PENDING' },
  });

  // ── DMCs, wholesale ──
  const dmcA = await prisma.dmc.create({ data: { name: 'Северный Ветер Тур (demo)', websiteUrl: 'https://severny-veter.example.com', contactName: 'Демо Менеджер', email: 'b2b@severny-veter.example.com', status: 'APPROVED' } });
  const dmcB = await prisma.dmc.create({ data: { name: 'Байкал Экспедиции (demo)', websiteUrl: 'https://baikal-exp.example.com', status: 'PENDING' } });
  await prisma.dmcPackageListing.create({ data: { dmcId: dmcA.id, packageId: gorilla.id, whiteLabelTitle: 'Гориллы Уганды — эксклюзивно (демо)', dmcPageUrl: 'https://severny-veter.example.com/uganda-gorillas' } });
  await prisma.quoteRequest.create({ data: { dmcId: dmcA.id, packageId: serengeti.id, createdAt: new Date(Date.now() - 5 * 3600 * 1000), pax: 6, travelStartDate: day('2027-07-01'), travelEndDate: day('2027-07-06'), notes: 'Нужна net-цена для группы (демо)' } });
  await prisma.quoteRequest.create({
    data: { dmcId: dmcA.id, packageId: gorilla.id, pax: 4, status: 'QUOTED', quotedPrice: 2200, quotedCurrency: 'USD', quoteTerms: 'Per person, net, valid 30 days (demo).', createdAt: new Date('2026-09-19T00:00:00Z'), quotedAt: new Date('2026-09-20T00:00:00Z') },
  });

  await prisma.famTrip.create({
    data: {
      title: 'Uganda fam trip for Russian DMCs (demo)', startDate: day('2027-03-02'), endDate: day('2027-03-08'), capacity: 8,
      itinerary: [{ day: 1, titleRu: 'Прилёт в Энтеббе' }, { day: 2, titleRu: 'Переезд в Бвинди', operatorId: pearl.id }],
      dmcs: { create: [{ dmcId: dmcA.id, representativeName: 'Демо Менеджер', confirmed: true }, { dmcId: dmcB.id }] },
      operators: { create: [{ operatorId: pearl.id, role: 'host', confirmed: true }] },
    },
  });

  // ── Telegram users & inquiries ──
  const tourist = await prisma.telegramUser.create({ data: { telegramId: BigInt(100000001), username: 'demo_tourist', firstName: 'Ольга', languageCode: 'ru', consentAt: new Date() } });
  await prisma.inquiry.create({
    data: { telegramUserId: tourist.id, operatorId: pearl.id, packageId: gorilla.id, contactName: 'Ольга', contactInfo: '@demo_tourist', message: 'Есть ли места на февраль для двоих? (демо)', travelMonth: '2027-02', groupSize: 2, status: 'RESPONDED',
      createdAt: new Date('2026-09-10T08:00:00Z'), firstResponseAt: new Date('2026-09-10T11:30:00Z') },
  });
  await prisma.inquiry.create({ data: { telegramUserId: tourist.id, operatorId: kilima.id, contactName: 'Ольга', contactInfo: '@demo_tourist', message: 'Сколько стоит сафари на 5 дней? (демо)' } });

  // ── Translators (Phase 2: linked to Telegram so offers reach them in the bot) ──
  const tgUser = (id: number, username: string, firstName: string) =>
    prisma.telegramUser.create({ data: { telegramId: BigInt(id), username, firstName, languageCode: 'ru', consentAt: new Date() } });
  const verified = { verificationStatus: 'VERIFIED' as const, spotCheckedAt: new Date('2026-09-02T00:00:00Z'), spotCheckedById: moderator.id };
  const tr = await prisma.translator.create({
    data: { name: 'Амина (демо)', telegramUsername: 'demo_amina', telegramUserId: (await tgUser(100000101, 'demo_amina', 'Amina')).id,
      languages: ['ru', 'en', 'sw'], proficiency: { ru: 'C1', en: 'C2', sw: 'native' }, specialtyCountryCode: 'TZ', specialties: ['safari_guide', 'documents', 'live_interpretation'],
      bioRu: 'Гид и переводчик в Аруше, училась в Москве. (демо)', spotCheckNotes: 'Video call in Russian, fluent (demo).', jobsCompleted: 1, rating: 5, ...verified },
  });
  const peter = await prisma.translator.create({
    data: { name: 'Питер (демо)', telegramUsername: 'demo_peter', telegramUserId: (await tgUser(100000102, 'demo_peter', 'Peter')).id,
      languages: ['ru', 'en', 'lg'], proficiency: { ru: 'B2', en: 'C2', lg: 'native' }, specialtyCountryCode: 'UG', specialties: ['city_guide', 'live_interpretation', 'business'],
      bioRu: 'Кампала и Энтеббе: встречи, рынки, деловые переговоры. (демо)', spotCheckNotes: 'Phone call in Russian; slower but clear (demo).', ...verified },
  });
  await prisma.translator.create({
    data: { name: 'Ванджиру (демо)', telegramUsername: 'demo_wanjiru', telegramUserId: (await tgUser(100000103, 'demo_wanjiru', 'Wanjiru')).id,
      languages: ['ru', 'en', 'sw'], proficiency: { ru: 'C1', en: 'native', sw: 'native' }, specialtyCountryCode: 'KE', specialties: ['medical', 'documents', 'legal'],
      bioRu: 'Медицинский и юридический перевод в Найроби. (демо)', spotCheckNotes: 'Translated a sample medical form (demo).', ...verified },
  });
  await prisma.translator.create({
    data: { name: 'Джозеф (демо)', telegramUsername: 'demo_joseph', telegramUserId: (await tgUser(100000104, 'demo_joseph', 'Joseph')).id,
      languages: ['ru', 'en'], proficiency: { ru: 'B1', en: 'C1' }, specialtyCountryCode: 'UG', specialties: ['live_interpretation'], bioRu: 'Учил русский в Казани. (демо)' },
  });
  await prisma.translationJob.create({
    data: { translatorId: tr.id, requesterType: 'TOURIST', requesterTelegramUserId: tourist.id, type: 'LIVE', status: 'COMPLETED', sourceLanguage: 'ru', targetLanguage: 'sw',
      description: 'Помощь на рынке в Аруше (демо)', completedAt: new Date('2026-09-15T00:00:00Z'), rating: 5, feedback: 'Спасибо! (демо)' },
  });
  await prisma.translationJob.create({
    data: { translatorId: peter.id, requesterType: 'TOURIST', requesterTelegramUserId: tourist.id, type: 'LIVE', status: 'ASSIGNED', sourceLanguage: 'ru', targetLanguage: 'en',
      description: 'Встреча с поставщиком в Кампале, нужен переводчик на 3 часа. (демо)', scheduledAt: new Date('2027-02-12T07:00:00Z') },
  });
  await prisma.translationJob.create({
    data: { requesterType: 'TOURIST', requesterTelegramUserId: tourist.id, type: 'DOCUMENT', status: 'REQUESTED', sourceLanguage: 'ru', targetLanguage: 'en',
      description: 'Перевести справку о прививках для поездки. Выбранный переводчик отказался. (демо)', deadline: day('2027-01-20') },
  });
  await prisma.translationJob.create({
    data: { requesterType: 'OPERATOR', requesterOperatorId: kilima.id, type: 'DOCUMENT', sourceLanguage: 'en', targetLanguage: 'ru', description: 'Translate package description (demo)', documentStorageKey: 'demo/kilima/package.docx' },
  });

  // ── Insurers (fictional) ──
  await prisma.insurer.createMany({
    data: [
      { name: 'Demo Strakhovanie A', nameRu: 'Демо Страхование А', websiteUrl: 'https://insurer-a.example.com', countriesCovered: ['UG', 'TZ', 'KE'], claimsContact: '+7 000 000-00-00 (demo)', repatriationConfirmed: true,
        coverageRu: 'Медицинские расходы, эвакуация, репатриация (демо)', exclusionsRu: 'Альпинизм выше 5000 м (демо)', medicalLimitInfo: 'до 50 000 € (демо)', verifiedAt: new Date('2026-09-01T00:00:00Z'), verifiedById: admin.id, published: true },
      { name: 'Demo Strakhovanie B', nameRu: 'Демо Страхование Б', countriesCovered: ['KE'], claimsContact: 'claims@insurer-b.example.com', repatriationConfirmed: false,
        coverageRu: 'Только медицинские расходы (демо)', notes: 'Repatriation not yet confirmed by phone.' },
      { name: 'Demo Strakhovanie C', nameRu: 'Демо Страхование В', websiteUrl: 'https://insurer-c.example.com', countriesCovered: ['UG', 'TZ', 'KE', 'RW'], claimsContact: '+7 000 111-11-11 (demo)', repatriationConfirmed: true,
        coverageRu: 'Медицина, эвакуация вертолётом, репатриация, задержка рейса (демо)', exclusionsRu: 'Дайвинг глубже 30 м; восхождение на Килиманджаро — только с доп. опцией (демо)', medicalLimitInfo: 'до 100 000 € (демо)',
        verifiedAt: new Date('2026-09-20T00:00:00Z'), verifiedById: admin.id, published: true },
      { name: 'Demo Strakhovanie D', nameRu: 'Демо Страхование Г', countriesCovered: ['TZ'], claimsContact: '+7 000 222-22-22 (demo)', repatriationConfirmed: false,
        coverageRu: 'Медицинские расходы (демо)', exclusionsRu: 'Нет покрытия на Занзибаре (демо)', medicalLimitInfo: 'до 30 000 € (демо)', verifiedAt: new Date('2026-08-15T00:00:00Z'), verifiedById: admin.id, published: true },
    ],
  });

  // ── Visa guides (DRAFT placeholders until verified) ──
  const placeholder = [
    '**ДЕМО-ТЕКСТ.** Перед запуском редактор должен сверить требования с официальным сайтом.',
    '',
    '## Кто подаёт',
    'Граждане России подают заявление онлайн до поездки.',
    '',
    '## Как подать',
    '1. Подготовьте документы из списка ниже.',
    '2. Заполните анкету на официальном сайте.',
    '3. Оплатите сбор на сайте и сохраните подтверждение.',
    '',
    'Сроки и сборы меняются — проверяйте их на официальном сайте.',
  ].join('\n');
  const checklist = [
    { key: 'passport', labelRu: 'Загранпаспорт, действующий 6+ месяцев', required: true },
    { key: 'photo', labelRu: 'Цифровое фото', required: true },
    { key: 'return_ticket', labelRu: 'Обратный билет', required: true },
    { key: 'yellow_fever', labelRu: 'Сертификат о прививке от жёлтой лихорадки', required: false },
  ];
  const ugVisa = await prisma.visaGuide.create({ data: { slug: 'uganda-evisa', status: 'PUBLISHED', countryCode: 'UG', coveredCountries: ['UG'], visaType: 'eVisa', titleRu: 'Электронная виза в Уганду', requirementsRu: placeholder, checklistItems: checklist, officialUrl: 'https://visas.immigration.go.ug' } });
  await prisma.visaGuide.create({ data: { slug: 'tanzania-zanzibar-evisa', status: 'PUBLISHED', countryCode: 'TZ', coveredCountries: ['TZ'], visaType: 'eVisa', titleRu: 'Электронная виза в Танзанию и на Занзибар', requirementsRu: placeholder, checklistItems: checklist, officialUrl: 'https://visa.immigration.go.tz' } });
  await prisma.visaGuide.create({ data: { slug: 'kenya-eta', status: 'PUBLISHED', countryCode: 'KE', coveredCountries: ['KE'], visaType: 'eTA', titleRu: 'Электронное разрешение на въезд (eTA) в Кению', requirementsRu: placeholder, checklistItems: checklist, officialUrl: 'https://www.etakenya.go.ke' } });
  await prisma.visaGuide.create({ data: { slug: 'east-african-tourist-visa', status: 'PUBLISHED', countryCode: 'KE', coveredCountries: ['KE', 'UG', 'RW'], visaType: 'East African Tourist Visa', titleRu: 'Восточноафриканская туристическая виза (Кения, Уганда, Руанда — без Танзании)', requirementsRu: placeholder, checklistItems: checklist } });
  await prisma.visaApplication.create({ data: { telegramUserId: tourist.id, visaGuideId: ugVisa.id, status: 'GATHERING_DOCUMENTS', travelDate: day('2027-02-14'), checkedItems: ['passport'] } });

  // ── Destination / logistics guides ──
  await prisma.destinationGuide.create({ data: { slug: 'uganda-how-to-get-there', countryCode: 'UG', kind: 'LOGISTICS', titleRu: 'Как добраться до Уганды', summaryRu: 'Маршруты через транзитные хабы (демо)', bodyRu: '**ДЕМО-ТЕКСТ.**\n\n## Перелёт\nПрямых рейсов из Москвы нет; обычно летят с одной пересадкой через крупный транзитный хаб.\n\n## Транзит\nПроверьте, нужна ли транзитная виза в стране пересадки.\n\n## Сезон\nСухие сезоны: декабрь–февраль и июнь–сентябрь.', status: 'PUBLISHED', publishedAt: new Date() } });
  await prisma.destinationGuide.create({ data: { slug: 'kenya-how-to-get-there', countryCode: 'KE', kind: 'LOGISTICS', titleRu: 'Как добраться до Кении', summaryRu: 'Найроби и Момбаса: варианты перелёта (демо)', bodyRu: '**ДЕМО-ТЕКСТ.**\n\n## Перелёт\nОсновные аэропорты — Найроби и Момбаса.\n\n## Сезон\nМиграция в Масаи-Мара — июль–октябрь.', status: 'PUBLISHED', publishedAt: new Date() } });
  await prisma.destinationGuide.create({ data: { slug: 'tanzania-how-to-get-there', countryCode: 'TZ', kind: 'LOGISTICS', titleRu: 'Как добраться до Танзании и Занзибара', summaryRu: 'Килиманджаро, Дар-эс-Салам, Занзибар (демо)', bodyRu: '**ДЕМО-ТЕКСТ.**\n\n## Перелёт\nДля сафари удобнее аэропорт Килиманджаро, для пляжей — Занзибар.', status: 'PUBLISHED', publishedAt: new Date() } });
  await prisma.destinationGuide.create({ data: { slug: 'uganda-overview', countryCode: 'UG', kind: 'DESTINATION', titleRu: 'Уганда: гориллы, Нил и вулканы', summaryRu: 'Главные места Уганды (демо)', bodyRu: '**ДЕМО-ТЕКСТ.**\n\nБвинди, Мерчисон-Фолс, Кибале и Рувензори.', status: 'PUBLISHED', publishedAt: new Date() } });
  await prisma.destinationGuide.create({ data: { slug: 'kenya-overview', countryCode: 'KE', kind: 'DESTINATION', titleRu: 'Кения: Масаи-Мара и океан', summaryRu: 'Главные места Кении (демо)', bodyRu: '**ДЕМО-ТЕКСТ.**\n\nМасаи-Мара, Амбосели, Самбуру и побережье.', status: 'PUBLISHED', publishedAt: new Date() } });
  await prisma.destinationGuide.create({ data: { slug: 'tanzania-overview', countryCode: 'TZ', kind: 'DESTINATION', titleRu: 'Танзания: что посмотреть', bodyRu: '**ДЕМО-ТЕКСТ.** Серенгети, Нгоронгоро, Занзибар.', status: 'PUBLISHED', publishedAt: new Date() } });

  // ── Partner portal logins (password = SEED_ADMIN_PASSWORD) ──
  const portalHash = await bcrypt.hash(adminPassword, 12);
  await prisma.account.create({ data: { email: 'operator@example.com', passwordHash: portalHash, role: 'OPERATOR', operatorId: pearl.id } });
  await prisma.account.create({ data: { email: 'operator2@example.com', passwordHash: portalHash, role: 'OPERATOR', operatorId: kilima.id } });
  await prisma.account.create({ data: { email: 'dmc@example.com', passwordHash: portalHash, role: 'DMC', dmcId: dmcA.id } });
  await prisma.account.create({ data: { email: 'dmc-pending@example.com', passwordHash: portalHash, role: 'DMC', dmcId: dmcB.id } });
  await prisma.account.create({ data: { email: 'portal@amina.example.com', passwordHash: portalHash, role: 'TRANSLATOR', translatorId: tr.id } });

  // ── Phase 3: more B2B activity ──
  const dmcC = await prisma.dmc.create({ data: { name: 'Солнечный Путь (demo)', websiteUrl: 'https://solnechny-put.example.com', contactName: 'Демо Директор', email: 'info@solnechny-put.example.com', status: 'APPROVED' } });
  // Unanswered for three days: shows up as slow on the dashboard and in Pearl's response score.
  await prisma.quoteRequest.create({
    data: { dmcId: dmcC.id, packageId: gorilla.id, pax: 8, travelStartDate: day('2027-02-14'), travelEndDate: day('2027-02-17'), notes: 'Корпоративная группа, нужны 4 двухместных номера (демо)', createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) },
  });
  await prisma.famTrip.create({
    data: {
      title: 'Kenya & Tanzania safari fam trip (demo)', startDate: day('2027-06-05'), endDate: day('2027-06-12'), capacity: 6, status: 'PLANNED',
      itinerary: [{ day: 1, titleRu: 'Прилёт в Найроби' }, { day: 2, titleRu: 'Масаи-Мара', operatorId: savanna.id }, { day: 5, titleRu: 'Серенгети', operatorId: kilima.id }],
      operators: { create: [{ operatorId: savanna.id, role: 'host', confirmed: true }, { operatorId: kilima.id, role: 'host' }] },
    },
  });

  // ── Phase 4: self-onboarding and the package feed ──
  // Signed up on the portal, application not sent yet (only the basics filled in).
  const draft = await prisma.operator.create({
    data: {
      slug: 'bwindi-forest-walkers-demo-ug', name: 'Bwindi Forest Walkers (demo)', countryCode: 'UG', licensingAuthority: 'Uganda Tourism Board',
      businessRegNumber: '', tourismBoardLicense: '', address: '', email: 'applicant@example.com', status: 'DRAFT', badgeToken: token(),
    },
  });
  await prisma.account.create({ data: { email: 'applicant@example.com', passwordHash: portalHash, role: 'OPERATOR', operatorId: draft.id } });
  // Flagged by staff: the operator sees the reason in the portal and can fix and resubmit.
  await prisma.account.create({ data: { email: 'flagged@example.com', passwordHash: portalHash, role: 'OPERATOR', operatorId: rift.id } });
  // Feed API key for Pearl. A fixed, fictional key so the docs' curl examples work against the dev database.
  await prisma.apiKey.create({ data: { operatorId: pearl.id, name: 'Website sync (demo)', prefix: DEMO_FEED_KEY.slice(0, 12), keyHash: sha256(DEMO_FEED_KEY) } });

  // Operator scores (spec TV-6) are computed, never typed in.
  const scoring = new ScoringService(prisma as unknown as PrismaService);
  await scoring.recomputeAll();

  console.log(
    `Seeded. Admin: ${adminEmail}, moderator@example.com, editor@example.com. Portal: operator@example.com, dmc@example.com, applicant@example.com. Password: SEED_ADMIN_PASSWORD. Feed API key: ${DEMO_FEED_KEY}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
