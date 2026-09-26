import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiActivity, FiCrosshair } from 'react-icons/fi';
import GeoMap from '../components/GeoMap';
import Legend from '../components/MapLegend';
import EmptyState from '../components/EmptyState';
import ConfidenceCard from '../components/ConfidenceCard';
import VerifyPanel from '../components/VerifyPanel';
import { Badge, Card, Skeleton, StatCard, cx, selectCls, td, th } from '../components/ui';
import { featureCollection } from '../components/mapStyle';
import { selectSelectedWard, selectSelectedWardId } from '../Redux/slices/wardsSlice';
import {
  fetchProperties, fetchPropertyById, fetchPropertyExplanation, selectProperties, selectPropertiesError,
  selectPropertiesStatus, selectSelectedProperty, setSelectedProperty,
} from '../Redux/slices/propertiesSlice';
import { fetchStats, selectWardStats } from '../Redux/slices/statsSlice';
import { DETECTION_TYPE, NDBI_LEGEND, PROPERTY_STATUS, fmtNum, ndbiColor } from '../utils/format';

function NdbiAlerts() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const ward = useSelector(selectSelectedWard);
  const items = useSelector(selectProperties);
  const status = useSelector(selectPropertiesStatus);
  const error = useSelector(selectPropertiesError);
  const selected = useSelector(selectSelectedProperty);
  const stats = useSelector(selectWardStats);
  const [type, setType] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    dispatch(setSelectedProperty(null));
    dispatch(fetchStats({ wardId: wardId ?? undefined }));
    if (wardId) dispatch(fetchProperties({ wardId }));
  }, [wardId, dispatch]);

  const rows = useMemo(() => (wardId ? items : []).filter((p) => (!type || p.detectionType === type) && (!statusFilter || p.status === statusFilter)), [items, type, statusFilter, wardId]);

  const select = (id) => {
    dispatch(setSelectedProperty(id));
    dispatch(fetchPropertyById(id));
    dispatch(fetchPropertyExplanation(id));
  };

  const layers = useMemo(() => [{
    id: 'detections',
    data: featureCollection(rows.filter((p) => p.lat && p.lng).map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        _color: p.id === selected?.id ? '#1d4f7c' : ndbiColor(p.ndbiDelta),
        _radius: Math.max(5, Math.min(14, Math.sqrt(p.areaSqm ?? 100) / 2)),
      },
    }))),
    color: '#e67e22',
    circleOpacity: 0.85,
  }], [rows, selected?.id]);

  const selectedP = selected ? rows.find((p) => p.id === selected.id) : null;

  return (
    <div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={FiActivity} label="Detections" value={fmtNum(stats?.totalDetections)} hint={wardId ? `Ward ${wardId}` : 'All wards'} />
        <StatCard icon={FiActivity} accent="#b42318" label="New builds" value={fmtNum(stats?.newBuilds)} />
        <StatCard icon={FiActivity} accent="#c2571a" label="Change of use" value={fmtNum(stats?.changeOfUse)} />
        <StatCard icon={FiActivity} accent="#2f6f8f" label="Awaiting verification" value={fmtNum(stats?.pendingVerification)} />
      </div>

      {!wardId ? (
        <Card><EmptyState icon={FiCrosshair} message="Select a ward in the top bar to review its detections on the map." /></Card>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="h-[420px] overflow-hidden rounded-xl border border-line">
              <GeoMap
                layers={layers}
                fitTo={selectedP ? [selectedP.lng, selectedP.lat, selectedP.lng, selectedP.lat] : ward?.bbox ? [ward.bbox.west, ward.bbox.south, ward.bbox.east, ward.bbox.north] : null}
                fitKey={`${wardId}-${selectedP?.id ?? ''}`}
                loading={status === 'loading'}
                onFeatureClick={(_, f) => select(String(f.properties.id))}
                legend={<Legend title="NDBI change" items={[...NDBI_LEGEND.map((l) => ({ ...l, shape: 'point' })), { color: '#1d4f7c', label: 'Selected', shape: 'point' }]} />}
              />
            </div>
            <Card className="min-w-0 p-0">
              <div className="flex flex-wrap items-center gap-2 border-b border-line-light p-3">
                <select className={selectCls} value={type} onChange={(e) => setType(e.target.value)} aria-label="Detection type">
                  <option value="">All types</option>
                  {Object.entries(DETECTION_TYPE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <select className={selectCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Verification status">
                  <option value="">All statuses</option>
                  {Object.entries(PROPERTY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <span className="ml-auto text-xs text-subtle">{rows.length} detections</span>
              </div>
              {error && <p className="px-3 pt-2 text-xs text-danger">{error}</p>}
              <div className="max-h-[40vh] overflow-auto">
                {status === 'loading' ? (
                  <div className="flex flex-col gap-2 p-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
                ) : rows.length === 0 ? <EmptyState icon={FiActivity} message="No detections match." /> : (
                  <table className="w-full min-w-[600px] border-collapse text-sm">
                    <thead><tr><th className={th}>ID</th><th className={th}>Type</th><th className={cx(th, 'text-right')}>Area m²</th><th className={cx(th, 'text-right')}>NDBI Δ</th><th className={cx(th, 'text-right')}>Conf.</th><th className={th}>Status</th></tr></thead>
                    <tbody>
                      {rows.map((p) => {
                        const t = DETECTION_TYPE[p.detectionType] ?? DETECTION_TYPE.change_of_use;
                        const s = PROPERTY_STATUS[p.status] ?? PROPERTY_STATUS.pending;
                        return (
                          <tr key={p.id} onClick={() => select(p.id)} aria-selected={selected?.id === p.id}
                            className={cx('cursor-pointer border-t border-line-light', selected?.id === p.id ? 'bg-primary-light' : 'hover:bg-hover')}>
                            <td className={cx(td, 'font-mono text-xs text-subtle')} title={p.id}>{p.id.slice(0, 8)}…</td>
                            <td className={td}><Badge tone={t.tone}>{t.label}</Badge></td>
                            <td className={cx(td, 'text-right tabular-nums')}>{p.areaSqm != null ? Math.round(p.areaSqm).toLocaleString() : '—'}</td>
                            <td className={cx(td, 'text-right tabular-nums')}><span className="mr-1 inline-block size-2 rounded-full" style={{ background: ndbiColor(p.ndbiDelta) }} />{p.ndbiDelta.toFixed(2)}</td>
                            <td className={cx(td, 'text-right tabular-nums')}>{Math.round(p.confidence * 100)}%</td>
                            <td className={td}><Badge tone={s.tone}>{s.label}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          </div>
          <div className="flex flex-col gap-4">
            {selected ? (<><ConfidenceCard /><VerifyPanel /></>) : (
              <Card><EmptyState icon={FiActivity} message="Select a detection to review its evidence signals, the model explanation, and record the field verification." /></Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NdbiAlerts;
