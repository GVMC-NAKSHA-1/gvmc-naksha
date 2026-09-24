import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FiChevronDown, FiClipboard } from 'react-icons/fi';
import { submitAssessment } from '../Redux/slices/assessmentsSlice';
import { selectSelectedProperty } from '../Redux/slices/propertiesSlice';
import { Button, cx, inputCls, labelCls } from './ui';

// Built but not mounted (see frontend.md §8.2 / quirk #7).
const CONSTRUCTION = ['Residential', 'Commercial', 'Mixed Use', 'Industrial'];
const VIOLATION = ['Unauthorized Construction', 'Change of Land Use', 'Building Extension', 'Commercial Conversion', 'Other'];
const ACTIONS = ['Verify', 'Issue Notice', 'Immediate Inspection', 'Demolition Review', 'Escalate'];

function Field({ label, children }) {
  return <label className="flex flex-col gap-1"><span className={labelCls}>{label}</span>{children}</label>;
}

export default function OfficerAssessmentForm({ baseYear, compareYear }) {
  const dispatch = useDispatch();
  const p = useSelector(selectSelectedProperty);
  const [open, setOpen] = useState(false);
  const breakdown = p?.confidenceBreakdown ?? {};
  const [form, setForm] = useState({
    propertyId: 'GVMC-000-0000', ownerName: '', doorNumber: '', surveyNumber: '', locality: '',
    constructionType: CONSTRUCTION[0], floors: '', builtUpAreaSqm: '', newlyConstructedAreaSqm: '',
    violationType: VIOLATION[0], remarks: '', estimatedTaxInr: '', estimatedPenaltyInr: '', recommendedAction: ACTIONS[0],
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    dispatch(submitAssessment({ ...form, propertyId: p?.id ?? form.propertyId, wardId: p?.wardId ?? null, baseYear, compareYear }));
    setOpen(false);
  };

  const context = [
    ['NDBI change', (breakdown.ndbi_delta ?? 0.18).toFixed(2)],
    ['Area difference', `${Math.round((p?.areaSqm ?? 0) * (breakdown.area_delta ?? 0))} m²`],
    ['Confidence', `${Math.round((p?.confidence ?? 0) * 100)}%`],
    ['Detection type', p?.detectionType ?? '—'],
    ['Coordinates', p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : '17.68690, 83.21850'],
  ];

  return (
    <section className="rounded-xl border border-line bg-white shadow-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 p-3 text-sm font-semibold">
        <FiClipboard className="text-primary" /> Officer Assessment
        <FiChevronDown className={cx('ml-auto transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line-light p-3">
          <dl className="grid grid-cols-2 gap-2 rounded-lg bg-canvas p-2 text-xs">
            {context.map(([k, v]) => (<div key={k}><dt className="text-subtle">{k}</dt><dd className="font-semibold">{v}</dd></div>))}
          </dl>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Property ID"><input className={inputCls} value={p?.id ?? form.propertyId} readOnly /></Field>
            <Field label="Owner Name"><input className={inputCls} value={form.ownerName} onChange={set('ownerName')} /></Field>
            <Field label="Door Number"><input className={inputCls} value={form.doorNumber} onChange={set('doorNumber')} /></Field>
            <Field label="Survey Number"><input className={inputCls} value={form.surveyNumber} onChange={set('surveyNumber')} /></Field>
            <Field label="Locality"><input className={inputCls} value={form.locality} onChange={set('locality')} /></Field>
            <Field label="Construction Type">
              <select className={inputCls} value={form.constructionType} onChange={set('constructionType')}>{CONSTRUCTION.map((o) => <option key={o}>{o}</option>)}</select>
            </Field>
            <Field label="Floors"><input type="number" className={inputCls} value={form.floors} onChange={set('floors')} /></Field>
            <Field label="Built-up Area m²"><input type="number" className={inputCls} value={form.builtUpAreaSqm} onChange={set('builtUpAreaSqm')} /></Field>
            <Field label="Newly Constructed m²"><input type="number" className={inputCls} value={form.newlyConstructedAreaSqm} onChange={set('newlyConstructedAreaSqm')} /></Field>
            <Field label="Violation Type">
              <select className={inputCls} value={form.violationType} onChange={set('violationType')}>{VIOLATION.map((o) => <option key={o}>{o}</option>)}</select>
            </Field>
            <Field label="Estimated Tax Impact ₹"><input type="number" className={inputCls} value={form.estimatedTaxInr} onChange={set('estimatedTaxInr')} /></Field>
            <Field label="Estimated Penalty ₹"><input type="number" className={inputCls} value={form.estimatedPenaltyInr} onChange={set('estimatedPenaltyInr')} /></Field>
          </div>
          <Field label="Recommended Action">
            <select className={inputCls} value={form.recommendedAction} onChange={set('recommendedAction')}>{ACTIONS.map((o) => <option key={o}>{o}</option>)}</select>
          </Field>
          <Field label="Officer Remarks"><textarea rows={2} className={inputCls} value={form.remarks} onChange={set('remarks')} /></Field>
          <Button type="submit" className="w-full">Submit Assessment</Button>
        </form>
      )}
    </section>
  );
}
