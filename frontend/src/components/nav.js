import {
  FiActivity, FiAlertTriangle, FiCheckSquare, FiCpu, FiCrosshair, FiDatabase, FiGitMerge, FiGrid,
  FiLayers, FiList, FiMap, FiShare2, FiShuffle, FiSliders, FiTool,
} from 'react-icons/fi';

/**
 * Single source of truth for navigation. Every destination carries a plain-language
 * `hint` that is shown as the link tooltip and as the page subtitle, so users know
 * where a link goes before clicking and what the page is for once they arrive.
 *
 * Steps follow the PS 26013 lifecycle: ingest → process → harmonize → validate → publish.
 */
export const HOME = { to: '/', label: 'Home', icon: FiGrid, end: true, hint: 'Progress of every step and what needs your attention' };
export const MAP = { to: '/map', label: 'Map viewer', icon: FiMap, hint: 'See every data layer for the ward together on one map' };

export const STEPS = [
  {
    n: 1, title: 'Bring in data', items: [
      { to: '/sources', label: 'Data sources', icon: FiDatabase, hint: 'Upload files and see every dataset received so far' },
      { to: '/georef', label: 'Align scanned maps', icon: FiCrosshair, hint: 'Pin scanned map sheets to real-world coordinates (geo-referencing)' },
    ],
  },
  {
    n: 2, title: 'Clean & detect', items: [
      { to: '/extraction', label: 'AI building detection', icon: FiCpu, hint: 'Find building footprints in drone / satellite imagery with AI' },
      { to: '/topology', label: 'Fix geometry errors', icon: FiTool, hint: 'Find and fix overlapping parcels, gaps and slivers (topology QA)' },
    ],
  },
  {
    n: 3, title: 'Match & resolve', items: [
      { to: '/matching', label: 'Match parcels', icon: FiGitMerge, hint: 'Pair the same parcel across different departments’ data' },
      { to: '/attributes', label: 'Match field names', icon: FiShuffle, hint: 'Link fields that mean the same thing, e.g. khata_no ↔ khata_number' },
      { to: '/conflicts', label: 'Resolve conflicts', icon: FiAlertTriangle, badge: 'conflicts', hint: 'Decide which source is right when two sources disagree' },
    ],
  },
  {
    n: 4, title: 'Check quality', items: [
      { to: '/validation', label: 'Quality check', icon: FiCheckSquare, hint: 'Data-quality score and structures that don’t match the cadastre' },
      { to: '/changes', label: 'Compare surveys', icon: FiActivity, hint: 'Spot new, demolished or extended buildings between two surveys' },
    ],
  },
  {
    n: 5, title: 'Publish', items: [
      { to: '/records', label: 'Final records', icon: FiLayers, hint: 'The merged, trusted parcel records (golden records) — review and download' },
      { to: '/exchange', label: 'Share with departments', icon: FiShare2, hint: 'Standard OGC API links other departments open in QGIS, ArcGIS, etc.' },
    ],
  },
];

export const ADMIN = [
  { to: '/activity', label: 'Activity log', icon: FiList, hint: 'Every automated job and every human decision, with time and ward' },
  { to: '/settings', label: 'Settings & health', icon: FiSliders, hint: 'System status, detection thresholds and API settings' },
];

/** Workflow pages in order, each tagged with its step — drives "Step N of 5" and Previous / Next. */
export const FLOW = STEPS.flatMap((s) => s.items.map((item) => ({ ...item, step: s })));

const ALL = [HOME, MAP, ...FLOW, ...ADMIN];

/** Look up the nav entry (and its step, for workflow pages) for a pathname. */
export function navFor(pathname) {
  return ALL.find((item) => item.to === pathname) ?? null;
}

export function neighbours(pathname) {
  const i = FLOW.findIndex((item) => item.to === pathname);
  if (i < 0) return { prev: null, next: null };
  return { prev: FLOW[i - 1] ?? null, next: FLOW[i + 1] ?? null };
}
