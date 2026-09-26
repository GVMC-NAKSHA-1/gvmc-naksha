import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiCopy, FiEye, FiShare2 } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import GeoMap from '../components/GeoMap';
import EmptyState from '../components/EmptyState';
import { Button, Card, PageHeader, SectionTitle, Skeleton, cx, td, th } from '../components/ui';
import { propsTable } from '../components/mapPopup';
import { selectSelectedWardId } from '../Redux/slices/wardsSlice';
import {
  fetchCollectionItems, fetchCollections, selectCollectionItems, selectCollections, selectCollectionsStatus, selectItemsStatus,
} from '../Redux/slices/qualitySlice';
import { API_URL, MOCK_MODE } from '../api/env';
import { fmtNum } from '../utils/format';

const base = () => `${MOCK_MODE || !API_URL ? window.location.origin : API_URL}/api/ogc`;

function Copy({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label="Copy URL" title="Copy URL"
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}
      className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-subtle hover:text-primary">
      <FiCopy /> {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function ExchangePage() {
  const dispatch = useDispatch();
  const wardId = useSelector(selectSelectedWardId);
  const collections = useSelector(selectCollections);
  const status = useSelector(selectCollectionsStatus);
  const items = useSelector(selectCollectionItems);
  const itemsStatus = useSelector(selectItemsStatus);
  const [active, setActive] = useState('harmonized-parcels');

  useEffect(() => { dispatch(fetchCollections()); }, [dispatch]);
  useEffect(() => { if (active) dispatch(fetchCollectionItems({ id: active, wardId: wardId ?? undefined })); }, [active, wardId, dispatch]);

  const fc = items?.id === active ? items.fc : null;
  const layers = useMemo(() => (fc ? [{ id: 'items', data: { type: 'FeatureCollection', features: fc.features }, color: '#1d4f7c', fillOpacity: 0.3, circleRadius: 6 }] : []), [fc]);
  const itemsUrl = (id) => `${base()}/collections/${id}/items${wardId ? `?wardId=${wardId}` : ''}`;

  return (
    <PageMotion className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        title="Share with departments"
        description="Harmonized land records are published through the OGC API – Features standard (GeoJSON, CRS84). Revenue, municipal, utility and planning departments consume them directly in QGIS, ArcGIS, GDAL or their own systems — no file hand-offs."
      />

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {[
          ['Landing page', base()],
          ['Conformance', `${base()}/conformance`],
          ['Collections', `${base()}/collections`],
        ].map(([l, u]) => (
          <Card key={l} className="flex flex-col gap-1">
            <SectionTitle>{l}</SectionTitle>
            <code className="truncate text-xs text-ink" title={u}>{u}</code>
            <div><Copy text={u} /></div>
          </Card>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="min-w-0 p-0">
          <div className="border-b border-line-light p-3"><SectionTitle>Collections ({collections.length})</SectionTitle></div>
          <div className="max-h-[520px] overflow-auto">
            {status === 'loading' && !collections.length ? <div className="flex flex-col gap-2 p-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              : collections.length === 0 ? <EmptyState icon={FiShare2} message="No collections published." /> : (
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead><tr><th className={th}>Collection</th><th className={cx(th, 'text-right')}>Features</th><th className={th}>Items URL</th><th className={th} /></tr></thead>
                  <tbody>
                    {collections.map((c) => (
                      <tr key={c.id} className={cx('border-t border-line-light', active === c.id ? 'bg-primary-light' : 'hover:bg-hover')}>
                        <td className={td}><span className="block font-medium">{c.title}</span><span className="block font-mono text-[11px] text-faint">{c.id}</span></td>
                        <td className={cx(td, 'text-right tabular-nums')}>{fmtNum(c.numberOfFeatures)}</td>
                        <td className={td}><Copy text={itemsUrl(c.id)} /></td>
                        <td className={td}><Button size="sm" variant="secondary" onClick={() => setActive(c.id)} title="Show a sample of this collection on the map"><FiEye /> Preview</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </Card>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="h-[420px] overflow-hidden rounded-xl border border-line">
            <GeoMap layers={layers} fitTo={fc?.features?.length ? fc : null} fitKey={`${active}-${fc?.numberReturned ?? 0}`} loading={itemsStatus === 'loading'}
              popup={(_, p) => propsTable(active, p)} />
          </div>
          {fc && (
            <p className="text-xs text-subtle">
              <strong className="text-ink">{fc.numberReturned}</strong> of {fc.numberMatched} features returned
              {fc.links?.some((l) => l.rel === 'next') && ' — follow the “next” link to page through the rest'}.
            </p>
          )}
          <Card>
            <SectionTitle className="mb-2">Use it in QGIS / GDAL</SectionTitle>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-subtle">
              <li>QGIS → Layer → Add Layer → Add WFS / OGC API – Features layer → New connection → URL: <code className="text-ink">{base()}</code></li>
              <li>GDAL: <code className="text-ink">ogr2ogr out.gpkg "OAPIF:{base()}" {active}</code></li>
              <li>Filter spatially with <code>?bbox=minLon,minLat,maxLon,maxLat</code>; page with <code>limit</code> / <code>offset</code>.</li>
            </ol>
          </Card>
        </div>
      </div>
    </PageMotion>
  );
}
