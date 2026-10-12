import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, ApiError, TravellerQuestion } from '../api';
import { dateEn } from '../format';

const STATUS: Record<TravellerQuestion['status'], [string, string]> = { NEW: ['wait', 'Waiting for you'], RESPONDED: ['ok', 'Answered'], CLOSED: ['off', 'Closed'] };
const time = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Questions travellers asked through our Telegram Mini App; the operator answers here and we deliver it. */
export function InboxPage() {
  const { data, error } = useQuery({ queryKey: ['inbox'], queryFn: api.inbox });
  if (error) return <p className="alert err">Couldn’t load your questions. Reload the page.</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const waiting = data.filter((q) => q.status === 'NEW').length;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <header className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Inbox</span>
        <h1>Questions from travellers</h1>
        <p className="muted">
          Travellers from Russia ask these through our Telegram app. Answer here; we send your answer to them in Telegram (or by email) and keep their
          contact details private. Answer in English or Russian. How fast you answer counts towards your response-time score.
        </p>
        {waiting > 0 && <p className="alert info">{waiting === 1 ? '1 question is' : `${waiting} questions are`} waiting for your answer.</p>}
      </header>
      {data.length === 0 && <p className="muted">No questions yet. They appear here when travellers ask about your tours.</p>}
      {data.map((q) => <Question key={q.id} q={q} />)}
    </div>
  );
}

function Question({ q }: { q: TravellerQuestion }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api.answerQuestion(q.id, text.trim()),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Couldn’t send. Try again.'),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (text.trim().length < 2) return setError('Write your answer first.');
    send.mutate();
  }
  const [kind, label] = STATUS[q.status];
  return (
    <article className="panel" aria-label={`Question from ${q.travellerName ?? 'a traveller'}`}>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <strong>{q.travellerName ?? 'A traveller'}{q.package ? ` · ${q.package.title}` : ''}</strong>
          <span className="small muted">
            Asked {time(q.createdAt)}{q.travelMonth && ` · travelling ${q.travelMonth}`}{q.groupSize && ` · ${q.groupSize} ${q.groupSize === 1 ? 'person' : 'people'}`}
          </span>
        </div>
        <span className={`pill ${kind}`}>{label}</span>
      </div>
      <p className="copybox" lang="ru" style={{ margin: 0 }}>{q.message}</p>
      {q.replies.length > 0 && (
        <ul className="doclist" aria-label="Answers sent">
          {q.replies.map((r) => (
            <li key={r.id} style={{ display: 'grid', gap: 4, justifyContent: 'stretch' }}>
              <span className="small muted">
                {r.by === 'staff' ? 'Our team answered for you' : 'You answered'} · {dateEn(r.createdAt)} · sent by {r.deliveredVia === 'EMAIL' ? 'email' : 'Telegram'}
              </span>
              <span style={{ whiteSpace: 'pre-wrap' }}>{r.body}</span>
            </li>
          ))}
        </ul>
      )}
      {q.status !== 'CLOSED' && (
        <form className="stack" style={{ gap: 8 }} onSubmit={submit}>
          <div className="field">
            <label htmlFor={`answer-${q.id}`}>{q.replies.length ? 'Send another answer' : 'Your answer'}</label>
            <textarea id={`answer-${q.id}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          {error && <p className="alert err" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={send.isPending} style={{ justifySelf: 'start' }}>
            {send.isPending ? 'Sending…' : 'Send to traveller'}
          </button>
        </form>
      )}
    </article>
  );
}
