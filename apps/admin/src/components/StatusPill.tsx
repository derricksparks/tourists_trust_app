import { titleCase } from '../format';

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill s-${status}`}>{label ?? titleCase(status)}</span>;
}
