import { useSelector } from 'react-redux';
import Markdown from './Markdown';
import {
  selectExplanationError, selectExplanationStatus, selectSelectedProperty,
} from '../Redux/slices/propertiesSlice';
import { DETECTION_TYPE, signalColor } from '../utils/format';
import Loader from './Loader';
import { Badge, SectionTitle } from './ui';

const SIGNALS = [
  { key: 'ndbi_delta', label: 'NDBI Delta' },
  { key: 'area_delta', label: 'Area Expansion' },
  { key: 'osm_status', label: 'OSM Status' },
  { key: 'ndvi_drop', label: 'Vegetation Drop' },
  { key: 'db_match', label: 'DB Match' },
];

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

export default function ConfidenceCard() {
  const p = useSelector(selectSelectedProperty);
  const explanationStatus = useSelector(selectExplanationStatus);
  const explanationError = useSelector(selectExplanationError);
  if (!p) return null;

  const type = DETECTION_TYPE[p.detectionType] ?? DETECTION_TYPE.change_of_use;
  const breakdown = p.confidenceBreakdown ?? {};

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div>
          <SectionTitle>Confidence</SectionTitle>
          <div className="text-3xl font-bold tabular-nums" style={{ color: signalColor(p.confidence) }}>
            {Math.round(p.confidence * 100)}%
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={type.tone}>{type.label}</Badge>
          <span className="text-xs tabular-nums text-subtle">
            {p.areaSqm != null ? `${Math.round(p.areaSqm).toLocaleString()} m²` : '—'}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        {SIGNALS.map((s) => {
          const v = clamp01(breakdown[s.key]);
          return (
            <div key={s.key}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-subtle">{s.label}</span>
                <span className="font-semibold tabular-nums text-ink">{Math.round(v * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line-light">
                <div className="h-full" style={{ width: `${v * 100}%`, background: signalColor(v) }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-line-light pt-3">
        {explanationStatus === 'loading' ? (
          <div className="flex items-center gap-2 text-xs text-subtle"><Loader size="sm" /> Loading model explanation…</div>
        ) : explanationStatus === 'failed' ? (
          <p className="text-xs italic text-subtle">{explanationError || 'Explanation unavailable.'}</p>
        ) : p.aiExplanation ? (
          <>
            <SectionTitle className="mb-1.5">Model explanation</SectionTitle>
            <div className="markdown"><Markdown>{p.aiExplanation}</Markdown></div>
          </>
        ) : null}
      </div>
    </section>
  );
}
