import { SPECIALTIES } from '@ttp/shared-types';
import type { Metadata } from 'next';
import Link from 'next/link';
import { TranslatorCard } from '@/components/TranslatorCard';
import { publicApi, telegramAppLink } from '@/lib/api';
import { countryRu } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Русскоговорящие гиды и переводчики в Уганде, Танзании и Кении',
  description: 'Проверенные переводчики и гиды: устный перевод на месте, перевод документов, медицина и деловые встречи.',
  alternates: { canonical: '/translators' },
};

type Props = { searchParams: { country?: string; specialty?: string } };
const COUNTRIES = ['UG', 'TZ', 'KE', 'RW'];

export default async function TranslatorsPage({ searchParams }: Props) {
  const country = COUNTRIES.includes(searchParams.country?.toUpperCase() ?? '') ? searchParams.country!.toUpperCase() : undefined;
  const specialty = searchParams.specialty && searchParams.specialty in SPECIALTIES ? searchParams.specialty : undefined;
  const list = await publicApi.translators({ country, specialty });
  const href = (p: { country?: string; specialty?: string }) => {
    const q = new URLSearchParams(Object.entries({ country, specialty, ...p }).filter((e): e is [string, string] => !!e[1]));
    return `/translators${q.size ? `?${q}` : ''}`;
  };

  return (
    <div className="page">
      <header className="stack" style={{ gap: 10 }}>
        <h1>Русскоговорящие гиды и переводчики</h1>
        <p className="muted prose">
          Каждого мы проверили: созвон на русском и пробное задание. Выберите человека и отправьте заявку в Telegram — после согласия
          переводчика вы получите его контакт. Оплату вы обсуждаете напрямую с ним.
        </p>
      </header>
      <nav className="stack" style={{ gap: 8 }} aria-label="Фильтры">
        <div className="chips">
          <Link href={href({ country: '' })} className="chip" aria-current={!country}>Все страны</Link>
          {COUNTRIES.map((c) => (
            <Link key={c} href={href({ country: c })} className="chip" aria-current={country === c}>{countryRu(c)}</Link>
          ))}
        </div>
        <div className="chips">
          <Link href={href({ specialty: '' })} className="chip" aria-current={!specialty}>Любая задача</Link>
          {Object.entries(SPECIALTIES).map(([k, v]) => (
            <Link key={k} href={href({ specialty: k })} className="chip" aria-current={specialty === k}>{v}</Link>
          ))}
        </div>
      </nav>
      {list.length ? (
        <div className="cards">
          {list.map((t) => (
            <TranslatorCard
              key={t.id}
              t={t}
              action={<a className="btn primary" style={{ justifySelf: 'start' }} href={telegramAppLink(`tr_${t.id}`)}>Заказать в Telegram</a>}
            />
          ))}
        </div>
      ) : (
        <p className="muted">По этим фильтрам пока никого нет. Попробуйте другую страну или задачу.</p>
      )}
      <section className="panel" aria-labelledby="join">
        <h2 id="join">Вы переводчик или гид?</h2>
        <p className="prose">Если вы говорите по-русски и работаете в Уганде, Танзании, Кении или Руанде, оставьте заявку в нашем Telegram-боте. Мы созвонимся и проверим язык.</p>
        <a className="btn" style={{ justifySelf: 'start' }} href={telegramAppLink('translator')}>Стать переводчиком</a>
      </section>
    </div>
  );
}
