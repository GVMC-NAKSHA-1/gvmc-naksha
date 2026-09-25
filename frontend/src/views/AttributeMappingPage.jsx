import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiArrowRight, FiCpu, FiShuffle } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import EmptyState from '../components/EmptyState';
import Loader from '../components/Loader';
import { Button, Card, Meter, Notice, PageHeader, SectionTitle, inputCls, labelCls, td, th, cx } from '../components/ui';
import { selectSelectedWardId } from '../Redux/slices/wardsSlice';
import { fetchSourceFeatures, fetchSources, selectSourceFeatures, selectSources } from '../Redux/slices/sourcesSlice';
import {
  clearSuggested, fetchMappings, selectMappings, selectMappingsStatus, selectSuggestError, selectSuggestStatus,
  selectSuggested, suggestMappings,
} from '../Redux/slices/harmonizationSlice';
import { signalColor, sourceLabel } from '../utils/format';

/** Columns of a source: structured schema, or OCR-extracted field names for scanned records. */
const columnsOf = (s) => (s?.fields?.length ? s.fields : Object.keys(s?.ocr ?? {}));

function SourceSelect({ label, value, onChange, sources, exclude }) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className={labelCls}>{label}</span>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a dataset…</option>
        {sources.filter((s) => s.id !== exclude).map((s) => (
          <option key={s.id} value={s.id}>{`${sourceLabel(s.type)} — ${s.filename ?? s.id.slice(0, 8)}`}</option>
        ))}
      </select>
    </label>
  );
}

function FieldList({ source, highlight }) {
  const cols = columnsOf(source);
  if (!source) return <p className="text-xs text-faint">—</p>;
  if (!cols.length) return <p className="text-xs text-subtle">No attribute schema recorded for this source.</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {cols.map((c) => (
        <code key={c} className={cx('rounded px-1.5 py-0.5 text-[11px]', highlight?.has(c) ? 'bg-success-light text-success-dark' : 'bg-canvas text-ink')}>{c}</code>
      ))}
    </div>
  );
}

function MappingTable({ rows, fieldLabels }) {
  return (
    <table className="w-full min-w-[560px] border-collapse text-sm">
      <thead><tr><th className={th}>{fieldLabels[0]}</th><th className={th} /><th className={th}>{fieldLabels[1]}</th><th className={cx(th, 'w-40')}>Confidence</th><th className={th}>Rationale</th></tr></thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id} className="border-t border-line-light">
            <td className={cx(td, 'font-mono text-xs')}>{m.fieldA}</td>
            <td className={cx(td, 'text-faint')}><FiArrowRight /></td>
            <td className={cx(td, 'font-mono text-xs')}>{m.fieldB}</td>
            <td className={td}>{m.confidence != null ? <Meter label="" value={m.confidence} color={signalColor(m.confidence)} /> : '—'}</td>
            <td className={cx(td, 'text-xs text-subtle')}>{m.rationale || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AttributeMappingPage() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const allSources = useSelector(selectSources);
  const featuresById = useSelector(selectSourceFeatures);
  const savedRaw = useSelector(selectMappings);
  // The backend appends on every save; show each source-pair/field correspondence once (highest confidence).
  const saved = useMemo(() => {
    const best = new Map();
    for (const m of savedRaw) {
      const k = `${m.sourceAId}|${m.sourceBId}|${m.fieldA}|${m.fieldB}`;
      if (!best.has(k) || (m.confidence ?? 0) > (best.get(k).confidence ?? 0)) best.set(k, m);
    }
    return [...best.values()];
  }, [savedRaw]);
  const savedStatus = useSelector(selectMappingsStatus);
  const suggested = useSelector(selectSuggested);
  const suggestStatus = useSelector(selectSuggestStatus);
  const suggestError = useSelector(selectSuggestError);
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [persist, setPersist] = useState(true);

  useEffect(() => {
    dispatch(fetchSources({ wardId: wardId ?? undefined }));
    setAId(''); setBId('');
  }, [wardId, dispatch]);
  useEffect(() => { dispatch(clearSuggested()); }, [aId, bId, dispatch]);
  useEffect(() => {
    dispatch(fetchMappings(aId && bId ? { sourceAId: aId, sourceBId: bId } : {}));
  }, [aId, bId, dispatch]);
  // Sample rows help the model disambiguate columns.
  useEffect(() => { [aId, bId].filter(Boolean).forEach((id) => dispatch(fetchSourceFeatures(id))); }, [aId, bId, dispatch]);

  const sources = useMemo(() => allSources.filter((s) => s.status === 'ready' || columnsOf(s).length), [allSources]);
  const a = sources.find((s) => s.id === aId);
  const b = sources.find((s) => s.id === bId);
  const sample = (id) => (featuresById[id]?.fc?.features ?? []).slice(0, 3).map((f) => Object.fromEntries(Object.entries(f.properties ?? {}).filter(([k]) => !k.startsWith('_'))));

  const run = () => dispatch(suggestMappings({
    a: { columns: columnsOf(a), sampleRows: sample(aId) },
    b: { columns: columnsOf(b), sampleRows: sample(bId) },
    sourceAId: persist ? aId : undefined,
    sourceBId: persist ? bId : undefined,
  })).then((res) => {
    if (persist && res.meta.requestStatus === 'fulfilled') dispatch(fetchMappings({ sourceAId: aId, sourceBId: bId }));
  });

  const mappedA = new Set(suggested.map((m) => m.fieldA));
  const mappedB = new Set(suggested.map((m) => m.fieldB));
  const nameOf = (id) => { const s = allSources.find((x) => x.id === id); return s ? `${sourceLabel(s.type)} · ${s.filename ?? id.slice(0, 8)}` : id?.slice(0, 8); };

  return (
    <PageMotion className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHeader
        step="Step 4 · Intelligent attribute mapping"
        title="Attribute mapping"
        description="Departments name the same attribute differently (khata_no vs khata_number, owner vs owner_name). The GeoAI model proposes field correspondences from both schemas and sample rows; saved mappings are used when merging attributes into golden records."
      />

      <Card className="mb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <SourceSelect label="Dataset A (canonical)" value={aId} onChange={setAId} sources={sources} exclude={bId} />
          <FiArrowRight className="mx-auto hidden shrink-0 text-faint md:mb-3 md:block" />
          <SourceSelect label="Dataset B" value={bId} onChange={setBId} sources={sources} exclude={aId} />
          <div className="flex flex-col gap-2 md:w-56">
            <label className="flex items-center gap-2 text-xs text-subtle">
              <input type="checkbox" className="accent-primary" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
              Save for golden-record assembly
            </label>
            <Button onClick={run} disabled={!a || !b || !columnsOf(a).length || !columnsOf(b).length || suggestStatus === 'loading'}>
              <FiCpu /> {suggestStatus === 'loading' ? 'Mapping…' : 'Suggest with AI'}
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div><SectionTitle className="mb-1.5">A · fields</SectionTitle><FieldList source={a} highlight={mappedA} /></div>
          <div><SectionTitle className="mb-1.5">B · fields</SectionTitle><FieldList source={b} highlight={mappedB} /></div>
        </div>
        {suggestStatus === 'failed' && <div className="mt-3"><Notice tone="danger">{suggestError}</Notice></div>}
      </Card>

      {suggestStatus === 'loading' && <div className="flex justify-center py-6"><Loader /></div>}
      {suggestStatus === 'succeeded' && (
        <Card className="mb-4 overflow-x-auto p-0">
          <div className="border-b border-line-light p-3"><SectionTitle>Suggested mappings ({suggested.length})</SectionTitle></div>
          {suggested.length ? <MappingTable rows={suggested} fieldLabels={['Field in A', 'Field in B']} /> : <EmptyState icon={FiShuffle} message="No corresponding fields found." />}
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-line-light p-3">
          <SectionTitle>{aId && bId ? 'Saved mappings for this pair' : 'All saved mappings'} ({saved.length})</SectionTitle>
        </div>
        {savedStatus === 'loading' ? <div className="flex justify-center py-6"><Loader /></div> : saved.length === 0 ? (
          <EmptyState icon={FiShuffle} message="No saved mappings yet. OCR'd revenue records are mapped automatically; pick two datasets above to map others." />
        ) : aId && bId ? (
          <MappingTable rows={saved} fieldLabels={['Field in A', 'Field in B']} />
        ) : (
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead><tr><th className={th}>Source A</th><th className={th}>Field</th><th className={th} /><th className={th}>Source B</th><th className={th}>Field</th><th className={cx(th, 'w-36')}>Confidence</th></tr></thead>
            <tbody>
              {saved.map((m) => (
                <tr key={m.id} className="border-t border-line-light">
                  <td className={cx(td, 'text-xs text-subtle')}>{nameOf(m.sourceAId)}</td>
                  <td className={cx(td, 'font-mono text-xs')}>{m.fieldA}</td>
                  <td className={cx(td, 'text-faint')}><FiArrowRight /></td>
                  <td className={cx(td, 'text-xs text-subtle')}>{nameOf(m.sourceBId)}</td>
                  <td className={cx(td, 'font-mono text-xs')}>{m.fieldB}</td>
                  <td className={td}>{m.confidence != null ? <Meter label="" value={m.confidence} color={signalColor(m.confidence)} /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PageMotion>
  );
}
