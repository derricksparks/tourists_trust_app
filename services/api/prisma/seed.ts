/**
 * Development fixture data. Every company, person and insurer here is FICTIONAL — names are
 * invented and marked "(demo)". Visa content is placeholder text left in DRAFT until staff
 * verify it against the official sources.
 *
 * Wipes all application tables first, so never run against production.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();
const token = () => randomBytes(32).toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function wipe() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  await wipe();

  // ── Reference data ──
  await prisma.country.createMany({
    data: [
      { code: 'UG', nameEn: 'Uganda', nameRu: 'Уганда' },
      { code: 'TZ', nameEn: 'Tanzania', nameRu: 'Танзания' },
      { code: 'KE', nameEn: 'Kenya', nameRu: 'Кения' },
      { code: 'RW', nameEn: 'Rwanda', nameRu: 'Руанда' },
      { code: 'RU', nameEn: 'Russia', nameRu: 'Россия' },
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
    slug: string; name: string; countryCode: string; licensingAuthority: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FLAGGED' | 'SUSPENDED';
    statusReason?: string; descriptionRu?: string; year?: number; video?: string;
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
        badgeToken: token(),
        ...(o.status === 'APPROVED' || o.status === 'SUSPENDED' ? { approvedAt, approvedById: moderator.id } : {}),
      },
    });

  const pearl = await op({ slug: 'pearl-gorilla-treks-demo-ug', name: 'Pearl Gorilla Treks (demo)', countryCode: 'UG', licensingAuthority: 'Uganda Tourism Board', status: 'APPROVED', year: 2011, video: 'https://www.youtube.com/watch?v=demo1', descriptionRu: 'Трекинг к горным гориллам в Бвинди и сафари в Королеве Елизавете. (демо)' });
  const kilima = await op({ slug: 'kilima-horizon-safaris-demo-tz', name: 'Kilima Horizon Safaris (demo)', countryCode: 'TZ', licensingAuthority: 'Tanzania Tourist Agency Licensing Authority (TALA)', status: 'APPROVED', year: 2008, video: 'https://www.youtube.com/watch?v=demo2', descriptionRu: 'Сафари в Серенгети и Нгоронгоро, восхождения на Килиманджаро. (демо)' });
  const savanna = await op({ slug: 'savanna-line-tours-demo-ke', name: 'Savanna Line Tours (demo)', countryCode: 'KE', licensingAuthority: 'Tourism Regulatory Authority (Kenya)', status: 'APPROVED', year: 2015, descriptionRu: 'Масаи-Мара, Амбосели и пляжи Диани. (демо)' });
  await op({ slug: 'zanzi-spice-journeys-demo-tz', name: 'Zanzi Spice Journeys (demo)', countryCode: 'TZ', licensingAuthority: 'Tanzania Tourist Agency Licensing Authority (TALA)', status: 'PENDING', year: 2019 });
  await op({ slug: 'nile-source-adventures-demo-ug', name: 'Nile Source Adventures (demo)', countryCode: 'UG', licensingAuthority: 'Uganda Tourism Board', status: 'PENDING', year: 2021 });
  await op({ slug: 'rift-valley-trails-demo-ke', name: 'Rift Valley Trails (demo)', countryCode: 'KE', licensingAuthority: 'Tourism Regulatory Authority (Kenya)', status: 'FLAGGED', statusReason: 'Licence number does not match the registry; asked operator for a copy.' });
  await op({ slug: 'quick-safari-deals-demo-ke', name: 'Quick Safari Deals (demo)', countryCode: 'KE', licensingAuthority: 'Tourism Regulatory Authority (Kenya)', status: 'REJECTED', statusReason: 'No valid tourism licence provided.' });
  await op({ slug: 'lake-mburo-camps-demo-ug', name: 'Lake Mburo Camps (demo)', countryCode: 'UG', licensingAuthority: 'Uganda Tourism Board', status: 'SUSPENDED', statusReason: 'Licence expired; awaiting renewal.', year: 2012 });

  await prisma.auditLog.createMany({
    data: [pearl, kilima, savanna].map((o) => ({
      actorAdminId: moderator.id, action: 'operator.approve', entityType: 'operator', entityId: o.id, metadata: { to: 'APPROVED' }, createdAt: approvedAt,
    })),
  });

  await prisma.operatorDocument.create({
    data: { operatorId: pearl.id, type: 'TOURISM_LICENSE', storageKey: 'demo/pearl/licence.pdf', originalFilename: 'licence.pdf', reviewedById: moderator.id, reviewedAt: approvedAt, reviewNotes: 'Matches UTB registry (demo).' },
  });
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
  const demoInviteTokens = ['demo-invite-used-1', 'demo-invite-used-2', 'demo-invite-open-1'];
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
  await prisma.quoteRequest.create({ data: { dmcId: dmcA.id, packageId: serengeti.id, pax: 6, travelStartDate: day('2027-07-01'), travelEndDate: day('2027-07-06'), notes: 'Нужна net-цена для группы (демо)' } });
  await prisma.quoteRequest.create({
    data: { dmcId: dmcA.id, packageId: gorilla.id, pax: 4, status: 'QUOTED', quotedPrice: 2200, quotedCurrency: 'USD', quoteTerms: 'Per person, net, valid 30 days (demo).', quotedAt: new Date('2026-09-20T00:00:00Z') },
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
    data: { telegramUserId: tourist.id, operatorId: pearl.id, packageId: gorilla.id, message: 'Есть ли места на февраль для двоих? (демо)', travelMonth: '2027-02', groupSize: 2, status: 'RESPONDED',
      createdAt: new Date('2026-09-10T08:00:00Z'), firstResponseAt: new Date('2026-09-10T11:30:00Z') },
  });
  await prisma.inquiry.create({ data: { telegramUserId: tourist.id, operatorId: kilima.id, message: 'Сколько стоит сафари на 5 дней? (демо)' } });

  // ── Translators ──
  const tr = await prisma.translator.create({
    data: { name: 'Demo Translator Amina', telegramUsername: 'demo_amina', languages: ['ru', 'en', 'sw'], proficiency: { ru: 'C1', en: 'C2', sw: 'native' },
      specialtyCountryCode: 'TZ', specialties: ['safari_guide', 'documents'], bioRu: 'Гид и переводчик в Аруше. (демо)', verificationStatus: 'VERIFIED',
      spotCheckedAt: new Date('2026-09-02T00:00:00Z'), spotCheckedById: moderator.id, spotCheckNotes: 'Video call in Russian, fluent (demo).', jobsCompleted: 1, rating: 5 },
  });
  await prisma.translator.create({ data: { name: 'Demo Translator Joseph', languages: ['ru', 'en'], proficiency: { ru: 'B2' }, specialtyCountryCode: 'UG', specialties: ['live_interpretation'] } });
  await prisma.translationJob.create({
    data: { translatorId: tr.id, requesterType: 'TOURIST', requesterTelegramUserId: tourist.id, type: 'LIVE', status: 'COMPLETED', sourceLanguage: 'ru', targetLanguage: 'sw',
      description: 'Помощь на рынке в Аруше (демо)', completedAt: new Date('2026-09-15T00:00:00Z'), rating: 5, feedback: 'Спасибо! (демо)' },
  });
  await prisma.translationJob.create({
    data: { requesterType: 'OPERATOR', requesterOperatorId: kilima.id, type: 'DOCUMENT', sourceLanguage: 'en', targetLanguage: 'ru', description: 'Translate package description (demo)', documentStorageKey: 'demo/kilima/package.docx' },
  });

  // ── Insurers (fictional) ──
  await prisma.insurer.createMany({
    data: [
      { name: 'Demo Strakhovanie A', nameRu: 'Демо Страхование А', countriesCovered: ['UG', 'TZ', 'KE'], claimsContact: '+7 000 000-00-00 (demo)', repatriationConfirmed: true,
        coverageRu: 'Медицинские расходы, эвакуация, репатриация (демо)', exclusionsRu: 'Альпинизм выше 5000 м (демо)', medicalLimitInfo: 'up to 50 000 EUR (demo)', verifiedAt: new Date('2026-09-01T00:00:00Z'), verifiedById: admin.id, published: true },
      { name: 'Demo Strakhovanie B', nameRu: 'Демо Страхование Б', countriesCovered: ['KE'], claimsContact: 'claims@insurer-b.example.com', repatriationConfirmed: false,
        coverageRu: 'Только медицинские расходы (демо)', notes: 'Repatriation not yet confirmed by phone.' },
    ],
  });

  // ── Visa guides (DRAFT placeholders until verified) ──
  const placeholder = '**ДЕМО-ТЕКСТ.** Требования необходимо проверить на официальном сайте перед публикацией.';
  const checklist = [
    { key: 'passport', labelRu: 'Загранпаспорт, действующий 6+ месяцев', required: true },
    { key: 'photo', labelRu: 'Цифровое фото', required: true },
    { key: 'return_ticket', labelRu: 'Обратный билет', required: true },
    { key: 'yellow_fever', labelRu: 'Сертификат о прививке от жёлтой лихорадки (если требуется)', required: false },
  ];
  const ugVisa = await prisma.visaGuide.create({ data: { slug: 'uganda-evisa', countryCode: 'UG', coveredCountries: ['UG'], visaType: 'eVisa', titleRu: 'Электронная виза в Уганду', requirementsRu: placeholder, checklistItems: checklist, officialUrl: 'https://visas.immigration.go.ug' } });
  await prisma.visaGuide.create({ data: { slug: 'tanzania-zanzibar-evisa', countryCode: 'TZ', coveredCountries: ['TZ'], visaType: 'eVisa', titleRu: 'Электронная виза в Танзанию и на Занзибар', requirementsRu: placeholder, checklistItems: checklist, officialUrl: 'https://visa.immigration.go.tz' } });
  await prisma.visaGuide.create({ data: { slug: 'kenya-eta', countryCode: 'KE', coveredCountries: ['KE'], visaType: 'eTA', titleRu: 'Электронное разрешение на въезд (eTA) в Кению', requirementsRu: placeholder, checklistItems: checklist, officialUrl: 'https://www.etakenya.go.ke' } });
  await prisma.visaGuide.create({ data: { slug: 'east-african-tourist-visa', countryCode: 'KE', coveredCountries: ['KE', 'UG', 'RW'], visaType: 'East African Tourist Visa', titleRu: 'Восточноафриканская туристическая виза (Кения, Уганда, Руанда — без Танзании)', requirementsRu: placeholder, checklistItems: checklist } });
  await prisma.visaApplication.create({ data: { telegramUserId: tourist.id, visaGuideId: ugVisa.id, status: 'GATHERING_DOCUMENTS', travelDate: day('2027-02-14'), checkedItems: ['passport'] } });

  // ── Destination / logistics guides ──
  await prisma.destinationGuide.create({ data: { slug: 'uganda-how-to-get-there', countryCode: 'UG', kind: 'LOGISTICS', titleRu: 'Как добраться до Уганды', summaryRu: 'Маршруты через транзитные хабы (демо)', bodyRu: '**ДЕМО-ТЕКСТ.** Варианты перелётов, транзитные визы, сезонность.', status: 'DRAFT' } });
  await prisma.destinationGuide.create({ data: { slug: 'tanzania-overview', countryCode: 'TZ', kind: 'DESTINATION', titleRu: 'Танзания: что посмотреть', bodyRu: '**ДЕМО-ТЕКСТ.** Серенгети, Нгоронгоро, Занзибар.', status: 'PUBLISHED', publishedAt: new Date() } });

  // ── Portal accounts (logins come in later phases; rows exist so the shape is exercised) ──
  const portalHash = await bcrypt.hash(adminPassword, 12);
  await prisma.account.create({ data: { email: 'portal@pearl-gorilla-treks-demo-ug.example.com', passwordHash: portalHash, role: 'OPERATOR', operatorId: pearl.id } });
  await prisma.account.create({ data: { email: 'portal@severny-veter.example.com', passwordHash: portalHash, role: 'DMC', dmcId: dmcA.id } });
  await prisma.account.create({ data: { email: 'portal@amina.example.com', passwordHash: portalHash, role: 'TRANSLATOR', translatorId: tr.id } });

  console.log(`Seeded. Admin login: ${adminEmail} / (SEED_ADMIN_PASSWORD). Also moderator@example.com and editor@example.com.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
