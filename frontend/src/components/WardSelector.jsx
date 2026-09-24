import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiChevronDown } from 'react-icons/fi';
import {
  fetchWards, selectSelectedWardId, selectWards, selectWardsStatus, setSelectedWard,
} from '../Redux/slices/wardsSlice';
import { fetchProperties } from '../Redux/slices/propertiesSlice';
import { fetchStats } from '../Redux/slices/statsSlice';

export default function WardSelector({ compareYear }) {
  const dispatch = useDispatch();
  const wards = useSelector(selectWards);
  const status = useSelector(selectWardsStatus);
  const selectedWardId = useSelector(selectSelectedWardId);

  useEffect(() => {
    if (status === 'idle') dispatch(fetchWards());
  }, [status, dispatch]);

  const handleChange = (e) => {
    const wardId = e.target.value || null;
    dispatch(setSelectedWard(wardId));
    if (!wardId) return;
    dispatch(fetchProperties({ wardId, compareYear }));
    dispatch(fetchStats({ wardId }));
  };

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <label className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle" htmlFor="ward-select">Ward</label>
      <div className="relative min-w-0 flex-1 sm:min-w-60">
        <select
          id="ward-select"
          className="w-full cursor-pointer appearance-none rounded-lg border border-line bg-canvas py-2 pl-3 pr-8 text-sm text-ink transition hover:border-primary focus:border-primary focus:shadow-focus focus:outline-none disabled:cursor-progress disabled:opacity-70"
          value={selectedWardId ?? ''}
          onChange={handleChange}
          disabled={status === 'loading'}
        >
          <option value="">{status === 'loading' ? 'Loading wards…' : '— Select a ward —'}</option>
          {wards.map((w) => (
            <option key={w.id} value={w.id}>
              {`Ward ${w.id} — ${w.name}`}{w.detectionCount > 0 ? ` (${w.detectionCount} detections)` : ''}
            </option>
          ))}
        </select>
        <FiChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
      </div>
    </div>
  );
}
