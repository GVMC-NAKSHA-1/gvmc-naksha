import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { FiArrowLeft, FiCamera, FiCheck } from 'react-icons/fi';
import {
  createTicket, getPhotoUploadUrl, resetCreateStatus, selectCreateError, selectCreateStatus,
} from '../Redux/slices/ticketsSlice';
import { selectSelectedWard } from '../Redux/slices/wardsSlice';
import { selectSelectedProperty } from '../Redux/slices/propertiesSlice';
import { Button, inputCls, labelCls } from './ui';

export default function RaiseTicketPanel({ onBack, onSuccess }) {
  const dispatch = useDispatch();
  const ward = useSelector(selectSelectedWard);
  const property = useSelector(selectSelectedProperty);
  const createStatus = useSelector(selectCreateStatus);
  const createError = useSelector(selectCreateError);
  const fileRef = useRef(null);

  const [houseNumber, setHouseNumber] = useState('');
  const [description, setDescription] = useState('');
  const [taxPending, setTaxPending] = useState('');
  const [photo, setPhoto] = useState({ state: 'idle', key: null, name: '', error: null });

  useEffect(() => {
    if (createStatus === 'succeeded') {
      dispatch(resetCreateStatus());
      onSuccess?.();
    }
  }, [createStatus, dispatch, onSuccess]);

  useEffect(() => () => { dispatch(resetCreateStatus()); }, [dispatch]);

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto({ state: 'uploading', key: null, name: file.name, error: null });
    const res = await dispatch(getPhotoUploadUrl(file.name));
    if (res.meta.requestStatus !== 'fulfilled') {
      setPhoto({ state: 'error', key: null, name: file.name, error: 'Failed to get upload URL.' });
      return;
    }
    try {
      const put = await fetch(res.payload.upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error();
      setPhoto({ state: 'ready', key: res.payload.s3_key, name: file.name, error: null });
    } catch {
      setPhoto({ state: 'error', key: null, name: file.name, error: 'Photo upload failed.' });
    }
  };

  const submit = (e) => {
    e.preventDefault();
    dispatch(createTicket({
      wardId: ward?.id ?? property?.wardId,
      propertyId: property?.id,
      houseNumber: houseNumber.trim(),
      description: description.trim(),
      taxPending,
      photoS3Key: photo.key,
    }));
  };

  const busy = createStatus === 'loading';

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col gap-3 rounded-xl border border-line bg-white p-3 shadow-sm"
    >
      <header className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="Back" className="inline-flex size-8 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink">
          <FiArrowLeft />
        </button>
        <h3 className="text-base font-semibold">Raise a Ticket</h3>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Ward</span>
          <input className={inputCls} value={ward ? `Ward ${ward.id} — ${ward.name}` : '—'} disabled />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>House Number*</span>
          <input className={inputCls} required placeholder="e.g. 12-4-56/A" value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Description*</span>
          <textarea className={inputCls} required rows={3} placeholder="Describe what you observed…" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Tax Pending (₹) <em className="font-normal text-faint">optional</em></span>
          <input className={inputCls} type="number" min="0" placeholder="e.g. 25000" value={taxPending} onChange={(e) => setTaxPending(e.target.value)} />
        </label>
        <div className="flex flex-col gap-1">
          <span className={labelCls}>Photograph <em className="font-normal text-faint">optional</em></span>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/heic,image/webp" hidden onChange={handlePhoto} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={photo.state === 'uploading'}>
              <FiCamera /> {photo.state === 'uploading' ? 'Uploading…' : 'Upload photo'}
            </Button>
            {photo.name && <span className="max-w-[180px] truncate text-xs text-subtle">{photo.name}</span>}
            {photo.state === 'ready' && <span className="inline-flex items-center gap-1 text-xs text-success"><FiCheck /> Photo ready</span>}
            {photo.state === 'error' && <span className="text-xs text-danger">{photo.error}</span>}
          </div>
        </div>

        <AnimatePresence>
          {createStatus === 'failed' && (
            <motion.p initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="rounded-md bg-danger-light px-3 py-1.5 text-xs text-danger-dark">
              {createError}
            </motion.p>
          )}
        </AnimatePresence>

        <Button type="submit" disabled={busy || !houseNumber.trim() || !description.trim()} className="w-full">
          {busy ? 'Submitting…' : 'Submit Ticket'}
        </Button>
      </form>
    </motion.section>
  );
}
