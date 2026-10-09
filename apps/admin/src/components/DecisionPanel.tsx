import { useState } from 'react';
import { ApiError } from '../api';

export interface DecisionOption<D extends string> {
  value: D;
  label: string;
  /** A reason is required and saved in the history. */
  needsReason: boolean;
  primary?: boolean;
  /** Can't be undone: ask once more before sending. */
  confirm?: string;
}

interface Props<D extends string> {
  id: string;
  options: DecisionOption<D>[];
  reasonPlaceholder: string;
  onDecide: (decision: D, reason: string | undefined) => Promise<unknown>;
}

/** Decision buttons with a shared reason box, used for operators and reviews. */
export function DecisionPanel<D extends string>({ id, options, reasonPlaceholder, onDecide }: Props<D>) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<DecisionOption<D> | null>(null);
  const reasonId = `reason-${id}`;
  const anyNeedsReason = options.some((o) => o.needsReason);

  async function run(option: DecisionOption<D>) {
    const trimmed = reason.trim();
    if (option.needsReason && !trimmed) {
      setError(`Add a reason before you ${option.label.toLowerCase()}. It is saved in the history.`);
      return;
    }
    if (option.confirm && confirming?.value !== option.value) {
      setConfirming(option);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onDecide(option.value, trimmed || undefined);
      setReason('');
      setConfirming(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {anyNeedsReason && (
        <div className="field">
          <label htmlFor={reasonId}>Reason</label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            aria-describedby={`${reasonId}-hint`}
          />
          <span id={`${reasonId}-hint`} className="hint">
            Required for {options.filter((o) => o.needsReason).map((o) => o.label.toLowerCase()).join(', ')}.
          </span>
        </div>
      )}
      {confirming ? (
        <div className="alert info stack" style={{ gap: 10 }} role="alertdialog" aria-label="Confirm decision">
          <p>{confirming.confirm}</p>
          <div className="row-wrap">
            <button className="btn danger" disabled={busy} onClick={() => run(confirming)}>
              Yes, {confirming.label.toLowerCase()}
            </button>
            <button className="btn" disabled={busy} onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row-wrap">
          {options.map((o) => (
            <button key={o.value} className={`btn ${o.primary ? 'primary' : ''}`} disabled={busy} onClick={() => run(o)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="alert err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
