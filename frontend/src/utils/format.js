import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export { dayjs };

export const fmtDateTime = (d) => (d ? dayjs(d).format('DD MMM YYYY HH:mm') : '—');
export const fmtShort = (d) => (d ? dayjs(d).format('DD MMM, HH:mm') : '—');
export const fmtRelative = (d) => (d ? dayjs(d).fromNow() : '');
export const fmtInr = (n) => (n == null || n === '' ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);
export const fmtNum = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString());
export const humanize = (s) => String(s ?? '').replace(/_/g, ' ');

// status → Badge tone (see components/ui.jsx)
export const PROPERTY_STATUS = {
  pending:          { tone: 'secondary', label: 'Pending' },
  verified:         { tone: 'success',   label: 'Verified' },
  underassessed:    { tone: 'warning',   label: 'Underassessed' },
  false_positive:   { tone: 'danger',    label: 'False Positive' },
  already_assessed: { tone: 'info',      label: 'Already Assessed' },
};

export const DETECTION_TYPE = {
  new_build:     { tone: 'danger', label: 'New Build' },
  change_of_use: { tone: 'orange', label: 'Change of Use' },
};

export const TICKET_STATUS = {
  open:         { tone: 'danger',  label: 'Open' },
  under_review: { tone: 'warning', label: 'Under Review' },
  resolved:     { tone: 'success', label: 'Resolved' },
};

export const ALERT_SEVERITY = {
  info: 'info', warning: 'warning', danger: 'danger',
  LOW: 'info', MEDIUM: 'warning', HIGH: 'danger',
};

export const SOURCE_STATUS = {
  ready: 'success', processing: 'secondary', pending_ocr: 'warning', failed: 'danger',
};

export const PIPELINE_STATUS = {
  idle: 'secondary', running: 'info', completed: 'success', failed: 'danger',
};

export const NDBI_LEGEND = [
  { color: '#c0392b', label: '≥0.30 High' },
  { color: '#e67e22', label: '≥0.20 Moderate' },
  { color: '#f1c40f', label: '≥0.10 Low' },
  { color: '#f9e79f', label: '<0.10 Minimal' },
  { color: '#ecf0f1', label: 'No data' },
];

/** NDBI delta → colour (same thresholds as the legend). */
export function ndbiColor(delta) {
  if (delta >= 0.3) return '#c0392b';
  if (delta >= 0.2) return '#e67e22';
  if (delta >= 0.1) return '#f1c40f';
  if (delta > 0) return '#f9e79f';
  return '#ecf0f1';
}

/** Confidence signal 0–1 → CSS colour. */
export const signalColor = (v) => (v >= 0.7 ? '#198754' : v >= 0.4 ? '#ffc107' : '#dc3545');
