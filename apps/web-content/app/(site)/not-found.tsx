import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="stack prose">
      <h1>Страница не найдена</h1>
      <p className="muted">
        Возможно, туроператор больше не проходит проверку или ссылка устарела. Посмотрите <Link href="/operators">список проверенных туроператоров</Link>.
      </p>
    </div>
  );
}
