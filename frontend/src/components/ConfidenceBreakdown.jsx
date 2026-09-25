import { CONFIDENCE_WEIGHTS, signalColor } from '../utils/format';
import { Meter } from './ui';

/** The four weighted terms behind a match's confidence score (worker match.py). */
export default function ConfidenceBreakdown({ breakdown, score }) {
  const terms = Object.entries(CONFIDENCE_WEIGHTS);
  return (
    <div className="flex flex-col gap-2">
      {terms.map(([k, { label, weight }]) => {
        const v = Number(breakdown?.[k] ?? 0);
        return <Meter key={k} label={`${label} × ${weight}`} value={v} color={signalColor(v)} />;
      })}
      <p className="text-[11px] text-subtle">
        Confidence = Σ weight × term{score != null && <> = <strong className="text-ink">{score}</strong></>}
      </p>
    </div>
  );
}
