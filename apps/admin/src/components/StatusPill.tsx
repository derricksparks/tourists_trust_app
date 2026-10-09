import { titleCase } from '../format';

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill s-${status}`}>{titleCase(status)}</span>;
}
