import { JobRequestForm } from '@/components/JobRequestForm';
import { TranslatorCard } from '@/components/TranslatorCard';
import { publicApi } from '@/lib/api';

export default async function TelegramTranslator({ params }: { params: { id: string } }) {
  const t = await publicApi.translator(params.id);
  return (
    <>
      <TranslatorCard t={t} />
      <section className="panel" aria-labelledby="req">
        <h2 id="req">Заявка</h2>
        <JobRequestForm translatorId={t.id} translatorName={t.name} languages={t.languages} />
      </section>
    </>
  );
}
