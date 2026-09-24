# GVMC Frontend — Complete Design & Build Specification

> Purpose: everything needed to build a **clone / replica** of the existing `D:\SIH\frontend` app from scratch.
> The spec is derived directly from the source code (not from plans). Exact values (tokens, colours, sizes, copy, API shapes) are given verbatim so the replica matches pixel-for-pixel and field-for-field.

---

## Table of contents
1. [Overview](#1-overview)
2. [Tech stack](#2-tech-stack)
3. [Folder structure](#3-folder-structure)
4. [Config & environment](#4-config--environment)
5. [App shell](#5-app-shell)
6. [Design system](#6-design-system)
7. [Global layout & navigation](#7-global-layout--navigation)
8. [Pages](#8-pages)
9. [Component reference](#9-component-reference)
10. [State management (Redux)](#10-state-management-redux)
11. [API contract](#11-api-contract)
12. [Mock mode (MSW)](#12-mock-mode-msw)
13. [Testing](#13-testing)
14. [Known quirks](#14-known-quirks)
15. [Rebuild checklist](#15-rebuild-checklist)

---

## 1. Overview

| Item | Value |
|---|---|
| Product | **GVMC Change-Detection Dashboard** — SIH problem statement **PS 26013 "NAKSHA"** |
| Domain | Multi-source geospatial harmonization + satellite change detection for **Greater Visakhapatnam Municipal Corporation (98 wards)** |
| Type | Single-page React app (SPA), desktop-first, responsive down to phones |
| Users / workspaces | Field Officer, Supervisor, Commissioner, Integration, Admin |
| Auth | **None.** All routes and endpoints are open ("demo mode"). The navbar switches roles instantly |
| Hosting | AWS Amplify (static `dist/`) |
| Backend | REST API (`VITE_API_URL`) + separate AI/agent API (`VITE_AGENT_API_URL`) |
| Map | Google Maps JS API via `@vis.gl/react-google-maps` |
| Visual style | Light, warm off-white canvas, Bootstrap-like palette, **floating pill navbar**, **frosted-glass side panels over a full-height map**, soft shadows, small staggered fade-up animations |

Core flows:
- **Field Officer:** pick a ward, then see detections on the map and in a list. Selecting a property shows its confidence breakdown and the AI explanation. The officer verifies it or raises a ticket. An AI chatbot is available.
- **Supervisor:** reviews field tickets, sees AI alerts and ward stats, exports a CSV, and reviews pending assessments.
- **Commissioner:** city-wide choropleth map, top 10 wards by unassessed count, and an AI daily brief.
- **Integration:** upload multi-source data, run spatial matching, see match scores and confidence bands, resolve conflicts, and export GeoJSON or CSV.
- **Admin:** upload the property CSV, set the DB config, trigger the detection pipeline, and tune the NDBI threshold.

---

## 2. Tech stack

### Runtime dependencies (`package.json`)
```json
"dependencies": {
  "@reduxjs/toolkit": "^2.12.0",
  "@vis.gl/react-google-maps": "^1.9.0",
  "axios": "^1.19.0",
  "dayjs": "^1.11.21",
  "framer-motion": "^12.43.0",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "react-icons": "^5.7.0",
  "react-markdown": "^10.1.0",
  "react-redux": "^9.3.0",
  "react-router-dom": "^7.18.2"
},
"devDependencies": {
  "@testing-library/jest-dom": "^7.0.0",
  "@testing-library/react": "^16.3.2",
  "@testing-library/user-event": "^14.6.1",
  "@vitejs/plugin-react": "^4.7.0",
  "jsdom": "^29.1.1",
  "msw": "^2.15.0",
  "vite": "^6.4.3",
  "vitest": "^4.1.10"
},
"msw": { "workerDirectory": ["public"] }
```
`"name": "gvmc-frontend"`, `"type": "module"`, `"private": true`.

### Scripts
```json
"start": "vite", "dev": "vite", "build": "vite build", "preview": "vite preview",
"test": "vitest run", "test:watch": "vitest"
```

### Library roles
| Library | Used for |
|---|---|
| Redux Toolkit + react-redux | All app state (11 slices, `createAsyncThunk` for API calls) |
| react-router-dom v7 | Flat routes via `<BrowserRouter>` + `<Routes>`; `NavLink` in navbar |
| axios | Two instances: `api` (main backend) and `agentApi` (AI service) |
| @vis.gl/react-google-maps | `<APIProvider>`, `<Map>`, `useMap()`; drawing via raw `google.maps.*` |
| framer-motion | Page fade, panel enter/exit, navbar active pill (`layoutId`), splash exit, toasts, modal |
| react-icons | `react-icons/fi` (Feather) everywhere + `MdSatellite` (brand) from `react-icons/md` |
| react-markdown | Rendering AI text (explanations, brief, chat replies) |
| dayjs (+ `relativeTime`) | Dates: `DD MMM YYYY HH:mm`, `DD MMM, HH:mm`, "2 hours ago" |
| MSW 2 | Browser mock API when `VITE_MOCK=true` |
| Vitest + Testing Library | Unit/component tests (jsdom) |

### Scaffold from zero
```bash
npm create vite@latest gvmc-frontend -- --template react
cd gvmc-frontend
npm i @reduxjs/toolkit react-redux react-router-dom axios @vis.gl/react-google-maps \
      framer-motion react-icons react-markdown dayjs
npm i -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event msw
npx msw init public/ --save
```

---

## 3. Folder structure

```
frontend/
├── index.html                      # <title>GVMC Change-Detection Dashboard</title>, #root, /src/main.jsx
├── vite.config.js                  # react plugin, envPrefix VITE_, vitest config
├── amplify.yml                     # Amplify build spec → dist/
├── package.json
├── .env                            # VITE_API_URL, VITE_AGENT_API_URL, VITE_GOOGLE_MAPS_API_KEY (git-ignored)
├── public/
│   ├── mockServiceWorker.js        # generated by `npx msw init public/`
│   └── mock-geojson/ward-N.json    # sample ward GeoJSON used by mocks
└── src/
    ├── main.jsx                    # entry: global CSS, optional MSW, Provider + BrowserRouter
    ├── App.jsx                     # shell: maps provider, splash, navbar, routes
    ├── api/
    │   ├── client.js               # axios `api` (default) + `agentApi`
    │   └── exportLayer.js          # GeoJSON / CSV export helpers
    ├── Redux/
    │   ├── Store.jsx               # configureStore with 11 reducers
    │   └── slices/                 # admin, alerts, assessments, chat, conflicts, harmonization,
    │                               # properties, sources, stats, tickets, wards
    ├── views/                      # one per route (+ co-located .css)
    │   ├── HomePage.jsx / .css
    │   ├── FieldOfficerView.jsx / .css
    │   ├── SupervisorView.jsx / .css
    │   ├── CommissionerView.jsx / .css
    │   ├── IntegrationView.jsx / .css  (+ IntegrationView.test.jsx)
    │   └── AdminPanel.jsx / .css
    ├── components/                 # shared components (+ co-located .css)
    │   ├── Navbar, DemoModeBadge, AppSplash, PageMotion, ScrollToTop, GoogleMapsProvider
    │   ├── MapView, WardSelector, StatsBar, ComparisonControls
    │   ├── PropertyList, ConfidenceCard, VerifyPanel, RaiseTicketPanel
    │   ├── AlertPanel, TicketsList, TicketReviewModal, PendingAssessmentsPanel
    │   ├── OfficerAssessmentForm (built, currently not mounted), ChatPanel
    │   └── Loader, EmptyState      (+ AppSplash/EmptyState/Loader .test.jsx)
    ├── styles/
    │   ├── variables.css           # design tokens
    │   ├── responsive.css          # layout tokens, fluid type/space, grid utilities
    │   ├── statusBadge.css         # badge colour sets
    │   └── global.css              # reset, shared utility classes, keyframes
    ├── mocks/
    │   ├── browser.js              # setupWorker(...handlers)
    │   ├── handlers.js             # MSW REST handlers
    │   └── data/                   # wards, properties, alerts, stats
    ├── mockData/
    │   ├── comparisonData.js       # year-comparison stats (2022/2024/2026)
    │   └── *.csv, generate_*.mjs   # sample CSVs + generators
    └── tests/setup.js              # import '@testing-library/jest-dom'
```

Conventions:
- One component per file. The default export is the component. Its CSS file sits next to it and is imported at the top (`import './X.css'`).
- Slices go in `Redux/slices/{feature}Slice.js`.
- Components never import raw `axios`. They go through thunks, which use `api/client.js`.

---

## 4. Config & environment

### `vite.config.js`
```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envPrefix: 'VITE_',
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.js',
  },
});
```
The original also has a no-op `treat-js-files-as-jsx` plugin; it does nothing and can be omitted.

### `index.html`
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GVMC Change-Detection Dashboard</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

### Environment variables
| Var | Required | Meaning |
|---|---|---|
| `VITE_API_URL` | yes | Base URL of the main backend (API Gateway `…/prod`). No trailing slash; paths start with `/api/...` |
| `VITE_AGENT_API_URL` | yes (for AI features) | Base URL of the AI/agent service (chat, explain, brief, alert generation) |
| `VITE_GOOGLE_MAPS_API_KEY` | yes | Google Maps JavaScript API key |
| `VITE_GOOGLE_MAPS_MAP_ID` | optional | Cloud-styled map ID; passed to `<Map mapId>` only if set |
| `VITE_MOCK` | optional | `'true'` enables the MSW mock API in the browser |

Always read these with `import.meta.env.VITE_*`, never `process.env`.

### `amplify.yml`
```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - nvm use 18 || true
        - npm ci --cache .npm --prefer-offline
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - .npm/**/*
      - node_modules/**/*
```
**SPA rewrite rule** (Amplify → Rewrites and redirects): source `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/>`, target `/index.html`, type **200 (Rewrite)**.
Set the `VITE_*` variables in Amplify → Environment variables.

---

## 5. App shell

### `src/main.jsx`
```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import store from './Redux/Store.jsx';
import App from './App.jsx';
import './styles/variables.css';     // order matters
import './styles/responsive.css';
import './styles/statusBadge.css';
import './styles/global.css';

async function enableMocking() {
  if (import.meta.env.VITE_MOCK !== 'true') return;
  const { worker } = await import('./mocks/browser.js');
  return worker.start({ onUnhandledRequest: 'warn', serviceWorker: { url: '/mockServiceWorker.js' } });
}

enableMocking().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Provider store={store}>
        <BrowserRouter><App /></BrowserRouter>
      </Provider>
    </React.StrictMode>
  );
});
```

### `src/App.jsx`
```jsx
export default function App() {
  const dispatch = useDispatch();
  const configStatus = useSelector(selectConfigStatus);
  const showSplash = configStatus === 'idle' || configStatus === 'loading';

  useEffect(() => { dispatch(fetchAdminConfig()); }, [dispatch]);

  return (
    <GoogleMapsProvider>
      <ScrollToTop />
      <AnimatePresence>{showSplash && <AppSplash key="app-splash" />}</AnimatePresence>
      <Navbar />
      <div className="main-content">
        <Routes>
          <Route path="/"             element={<HomePage />} />
          <Route path="/officer"      element={<FieldOfficerView />} />
          <Route path="/supervisor"   element={<SupervisorView />} />
          <Route path="/commissioner" element={<CommissionerView />} />
          <Route path="/admin"        element={<AdminPanel />} />
          <Route path="/integration"  element={<IntegrationView />} />
        </Routes>
      </div>
    </GoogleMapsProvider>
  );
}
```
- The splash stays up until `GET /api/stats` (`fetchAdminConfig`) succeeds **or** fails, then fades out over 0.35s.
- There is no 404 route. Unknown paths render only the navbar.

### `src/api/client.js`
```js
import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL, headers: { 'Content-Type': 'application/json' } });
api.interceptors.response.use((r) => r, (error) => {
  console.error('[API Error]', error.response?.status, error.config?.url, error.message);
  return Promise.reject(error);
});

export const agentApi = axios.create({ baseURL: import.meta.env.VITE_AGENT_API_URL, headers: { 'Content-Type': 'application/json' } });
agentApi.interceptors.response.use((r) => r, (error) => {
  console.error('[Agent API Error]', error.response?.status, error.config?.url, error.message);
  return Promise.reject(error);
});

export default api;
```
No auth headers are sent.

### `src/api/exportLayer.js`
```js
export const EXPORT_LAYERS = [
  { value: 'parcels',        label: 'Master parcels' },
  { value: 'conflicts',      label: 'Conflicts' },
  { value: 'source_records', label: 'Source records' },
];
// downloadGeoJSON(layer, wardId): GET /api/export/geojson?layer=&ward_id=
//   → builds Blob('application/geo+json'), triggers download "gvmc_{layer}.geojson", returns { count, truncated }
// exportCsv(layer, wardId): POST /api/export/csv { layer, ward_id? }
//   → window.open(data.presigned_url, '_blank', 'noopener'), returns { count: data.row_count }
```

---

## 6. Design system

### 6.1 Tokens — `src/styles/variables.css` (verbatim)
```css
:root {
  /* Brand */
  --color-primary:        #0d6efd;
  --color-primary-hover:  #0b5ed7;
  --color-primary-light:  #e7f1ff;
  --color-primary-dark:   #084298;
  --color-secondary:      #6c757d;
  --color-secondary-hover:#5c636a;
  --color-secondary-light:#e9ecef;
  /* Semantic */
  --color-success:        #198754;
  --color-success-light:  #d1e7dd;
  --color-danger:         #dc3545;
  --color-danger-light:   #f8d7da;
  --color-warning:        #ffc107;
  --color-warning-light:  #fff3cd;
  --color-info:           #0dcaf0;
  --color-info-light:     #cff4fc;
  /* Neutrals */
  --color-gray-50:  #f8f9fa;  --color-gray-100: #f1f3f5;  --color-gray-200: #e9ecef;
  --color-gray-300: #dee2e6;  --color-gray-400: #ced4da;  --color-gray-500: #adb5bd;
  --color-gray-600: #6c757d;  --color-gray-700: #495057;  --color-gray-800: #343a40;
  --color-gray-900: #212529;
  /* Backgrounds (warm off-white canvas) */
  --bg-primary:   #ffffff;
  --bg-secondary: #f8f6f3;
  --bg-tertiary:  #f2f0ec;
  --bg-hover:     #f2f0ec;
  --bg-sidebar:   #1a1d21;
  --bg-overlay:   rgba(0, 0, 0, 0.5);
  /* Text */
  --text-primary:   #212529;
  --text-secondary: #6c757d;
  --text-muted:     #adb5bd;
  --text-light:     #ffffff;
  --text-link:      #0d6efd;
  /* Borders */
  --border-color:       #dee2e6;
  --border-color-light: #e9ecef;
  --border-color-focus: #0d6efd;

  /* Typography */
  --font-family-base: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-family-mono: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  --font-size-xs: 0.75rem;  --font-size-sm: 0.8125rem; --font-size-base: 0.875rem;
  --font-size-md: 1rem;     --font-size-lg: 1.125rem;  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;  --font-size-3xl: 1.875rem;
  --font-weight-light: 300; --font-weight-normal: 400; --font-weight-medium: 500;
  --font-weight-semibold: 600; --font-weight-bold: 700;
  --line-height-tight: 1.25; --line-height-normal: 1.5; --line-height-relaxed: 1.75;

  /* Fixed spacing */
  --spacing-1: 0.25rem; --spacing-2: 0.5rem; --spacing-3: 0.75rem; --spacing-4: 1rem;
  --spacing-5: 1.25rem; --spacing-6: 1.5rem; --spacing-8: 2rem; --spacing-10: 2.5rem; --spacing-12: 3rem;

  /* Shape */
  --radius-sm: 0.25rem; --radius-md: 0.375rem; --radius-lg: 0.5rem;
  --radius-xl: 0.75rem; --radius-2xl: 1rem;    --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
  --shadow-focus: 0 0 0 3px var(--color-primary-light);
  --shadow-float: 0 24px 48px -12px rgba(20, 20, 20, 0.18), 0 4px 12px -2px rgba(20, 20, 20, 0.08);

  /* Glass surfaces */
  --glass-bg:      color-mix(in srgb, var(--bg-primary) 86%, transparent);
  --glass-bg-soft: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  --glass-border:  color-mix(in srgb, var(--border-color) 65%, transparent);
  --glass-blur:    20px;

  /* Motion */
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-out:      cubic-bezier(0, 0, 0.2, 1);
  --transition-fast:   150ms var(--ease-standard);
  --transition-normal: 250ms var(--ease-standard);
  --transition-slow:   350ms var(--ease-standard);

  /* Z-index */
  --z-dropdown: 100; --z-sticky: 200; --z-fixed: 300;
  --z-modal-backdrop: 400; --z-modal: 500; --z-toast: 800;

  /* Component tokens */
  --card-padding: var(--spacing-6); --card-border-radius: var(--radius-lg);
  --card-shadow: var(--shadow-sm);  --card-bg: var(--bg-primary);
  --input-border-color: var(--border-color);
  --input-focus-border-color: var(--color-primary);
  --input-placeholder-color: var(--color-gray-500);

  /* NDBI choropleth scale */
  --ndbi-high:     #c0392b;
  --ndbi-moderate: #e67e22;
  --ndbi-low:      #f1c40f;
  --ndbi-minimal:  #f9e79f;
  --ndbi-none:     #ecf0f1;
}
```

### 6.2 Layout + fluid scale — `src/styles/responsive.css` (verbatim)
```css
:root {
  --navbar-height:     60px;
  --navbar-margin-top: 16px;
  --nav-offset: calc(var(--navbar-margin-top) + var(--navbar-height) + 16px);  /* = 92px */
  --page-padding-x:  clamp(12px, 4vw, 20px);
  --page-padding-y:  clamp(12px, 3vh, 20px);
  --table-min-width: 600px;

  /* Fluid font scale — USE THESE in components */
  --font-xs:   clamp(10px, 1.2vw, 12px);
  --font-sm:   clamp(12px, 1.4vw, 13px);
  --font-base: clamp(13px, 1.5vw, 14px);
  --font-md:   clamp(14px, 1.8vw, 16px);
  --font-lg:   clamp(16px, 2vw, 20px);
  --font-xl:   clamp(20px, 2.5vw, 24px);
  --font-2xl:  clamp(24px, 3vw, 32px);

  /* Fluid spacing — USE THESE in components */
  --space-1: clamp(4px,  0.5vw,  6px);
  --space-2: clamp(8px,  1vw,   12px);
  --space-3: clamp(12px, 1.5vw, 16px);
  --space-4: clamp(16px, 2vw,   20px);
  --space-5: clamp(20px, 2.5vw, 24px);
  --space-6: clamp(24px, 3vw,   32px);
  --space-7: clamp(32px, 4vw,   48px);
  --space-8: clamp(40px, 5vw,   64px);
}

.main-content { padding-top: var(--nav-offset); min-height: 100vh; }

.grid        { display: grid; gap: var(--spacing-4); }
.grid-cols-1 { grid-template-columns: 1fr; }
.grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
.grid-cols-3 { grid-template-columns: repeat(3, 1fr); }
.grid-cols-4 { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 1024px) { .lg\:grid-cols-2 { grid-template-columns: repeat(2, 1fr); } .lg\:grid-cols-1 { grid-template-columns: 1fr; } }
@media (max-width: 768px)  { .grid-cols-2, .grid-cols-3, .grid-cols-4 { grid-template-columns: 1fr; } }

.table-responsive { overflow-x: auto; -webkit-overflow-scrolling: touch; }
```
> Components use the **fluid** `--font-*` and `--space-*` scales. The fixed `--font-size-*` and `--spacing-*` scales are rarely used.

### 6.3 Status badges — `src/styles/statusBadge.css` (verbatim)
```css
:root {
  --status-success-bg:   #d1e7dd;  --status-success-text:   #0f5132;
  --status-warning-bg:   #fff3cd;  --status-warning-text:   #664d03;
  --status-danger-bg:    #f8d7da;  --status-danger-text:    #842029;
  --status-info-bg:      #cff4fc;  --status-info-text:      #055160;
  --status-primary-bg:   #cfe2ff;  --status-primary-text:   #084298;
  --status-secondary-bg: #e9ecef;  --status-secondary-text: #495057;
  --status-purple-bg:    #e8daef;  --status-purple-text:    #6f42c1;
  --status-orange-bg:    #ffe5d0;  --status-orange-text:    #7d2e00;
  --status-dark-bg:      #d3d3d4;  --status-dark-text:      #1a1e21;
}
.status-badge {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: var(--radius-full, 9999px);
  font-size: var(--font-xs, 11px); font-weight: var(--font-weight-semibold, 600);
  text-transform: capitalize; white-space: nowrap; letter-spacing: 0.02em;
  transition: background var(--transition-fast), color var(--transition-fast);
  animation: fadeInUp var(--transition-fast);
}
.status-badge-success   { background: var(--status-success-bg);   color: var(--status-success-text); }
.status-badge-warning   { background: var(--status-warning-bg);   color: var(--status-warning-text); }
.status-badge-danger    { background: var(--status-danger-bg);    color: var(--status-danger-text); }
.status-badge-info      { background: var(--status-info-bg);      color: var(--status-info-text); }
.status-badge-primary   { background: var(--status-primary-bg);   color: var(--status-primary-text); }
.status-badge-secondary { background: var(--status-secondary-bg); color: var(--status-secondary-text); }
.status-badge-purple    { background: var(--status-purple-bg);    color: var(--status-purple-text); }
.status-badge-orange    { background: var(--status-orange-bg);    color: var(--status-orange-text); }
.status-badge-dark      { background: var(--status-dark-bg);      color: var(--status-dark-text); }
```
**Badge usage pattern (used everywhere):** a `<span className="status-badge">` with inline style
`{ background: \`var(--status-${cls}-bg)\`, color: \`var(--status-${cls}-text)\` }`, where `cls` comes from a status → class map.

### 6.4 Global base — `src/styles/global.css` (verbatim)
```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-family: var(--font-family-base); font-size: 16px; -webkit-text-size-adjust: 100%; }
body {
  background-color: var(--bg-secondary);
  background-image: radial-gradient(ellipse 900px 480px at 50% -8%, rgba(13, 110, 253, 0.05), transparent 60%);
  background-repeat: no-repeat; background-attachment: fixed;
  color: var(--text-primary); line-height: var(--line-height-normal); font-size: var(--font-base);
}
a { color: var(--text-link); text-decoration: none; }
a:hover { text-decoration: underline; }
button { cursor: pointer; font-family: inherit; }
input, select, textarea { font-family: inherit; font-size: inherit; }
h1, h2, h3, h4, h5, h6 { font-weight: var(--font-weight-semibold); line-height: var(--line-height-tight); color: var(--text-primary); }
#root { min-height: 100vh; }

.view-error-banner {
  padding: var(--space-2) var(--space-4); background: var(--status-danger-bg); color: var(--status-danger-text);
  border-radius: var(--radius-md); font-size: var(--font-sm); margin-bottom: var(--space-3); border: 1px solid var(--color-danger);
}
.view-container { max-width: 1800px; width: 100%; margin-inline: auto; }
.view-kicker {            /* small blue uppercase eyebrow above page titles */
  display: block; font-size: var(--font-xs); font-weight: var(--font-weight-semibold);
  text-transform: uppercase; letter-spacing: 0.12em; color: var(--color-primary); margin-bottom: var(--space-1);
}
.glass-panel {            /* frosted floating surface */
  background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)); -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border); border-radius: var(--radius-xl); box-shadow: var(--shadow-float);
}
.skeleton-bar {
  display: inline-block;
  background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-hover) 50%, var(--bg-secondary) 75%);
  background-size: 200% 100%; border-radius: var(--radius-sm); animation: shimmer 1.2s ease-in-out infinite;
}
@keyframes spin          { to { transform: rotate(360deg); } }
@keyframes shimmer       { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes typing-bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }
@keyframes fadeInUp      { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes pulse-fade    { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
@keyframes scaleIn       { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
```

### 6.5 Visual language & conventions
- **Canvas:** warm off-white `#f8f6f3` with a faint blue radial glow at the top. Cards are white with a `1px #dee2e6` border and `--shadow-sm`, and lift to `--shadow-md` on hover.
- **Surfaces:**
  - white **cards** (radius `--radius-lg` or `--radius-xl`)
  - **glass panels** (86 % white + 20px blur + `--shadow-float`) that float beside the map
  - **pill** shapes for the navbar, chips and toggles
- **Typography:**
  - system UI stack
  - titles use semibold or bold with slight negative letter-spacing (`-0.01em` to `-0.02em`)
  - section headings are **UPPERCASE, `--font-xs`, letter-spacing `0.05–0.12em`, muted colour**
  - numbers use `font-variant-numeric: tabular-nums`
- **Accent pattern:** each item gets a CSS custom property `--accent` (a colour) and `--row-index` (an integer). The CSS uses them for a coloured dot or icon tint via `color-mix(in srgb, var(--accent) 12%, transparent)` and a **staggered entrance** `animation: fadeInUp … both; animation-delay: calc(var(--row-index) * 50ms)`.
- **Naming:** BEM (`.property-list__row--selected`). Each component's CSS lives next to its JSX.
- **Rules:** never hardcode colours, sizes or spacing (use tokens), and never use `!important` in component CSS. The one existing exception is `.navbar__link--active`.
- **Breakpoints:**
  - `1024px`: map pages stack vertically
  - `768px`: navbar collapses to a hamburger; touch targets become ≥ 44px
  - `600px`: home rows compact
  - Integration grid only: `1100px` → 2 columns, `700px` → 1 column
- **Motion (framer-motion):**
  - Page wrapper `PageMotion`: opacity 0 → 1 over **0.25s**, ease `[0.4, 0, 0.2, 1]`
  - Panels, detail cards and toasts: `initial {opacity:0, y:8}` → `animate {opacity:1, y:0}` → `exit {opacity:0, y:-4}`, **0.2s**, same ease
  - Success and error messages: `scale 0.98 → 1`, 0.2s
  - Navbar active link: shared `layoutId="navbar-active-pill"` sliding pill, 0.25s
- **Icons:** Feather (`react-icons/fi`) at 12–18px; the brand icon is `MdSatellite`.
- **Currency and locale:** ₹ with `toLocaleString('en-IN')` (tickets); dates `toLocaleDateString('en-IN')`, or dayjs `DD MMM YYYY HH:mm`.

---

## 7. Global layout & navigation

### 7.1 Page frame
```
┌───────────────────────────────────────────────────────────────┐
│           ╭─────────────────────────────────────────╮         │  ← navbar: fixed, 16px from top,
│           │ [🛰 GVMC]  Field Officer Supervisor …  [Demo Mode] │    centred pill, max 920px
│           ╰─────────────────────────────────────────╯         │
│                                                               │
│  .main-content  (padding-top: --nav-offset = 92px)            │
│     └─ <PageMotion className="{page}"> … </PageMotion>        │
└───────────────────────────────────────────────────────────────┘
```

### 7.2 Navbar (`components/Navbar.jsx`)
- **Links (in order):**
  - `/officer` "Field Officer"
  - `/supervisor` "Supervisor"
  - `/commissioner` "Commissioner"
  - `/integration` "Integration"
  - `/admin` "Admin"
- **Brand:** a `NavLink to="/"` with a 30×30 rounded tile (primary at 12 % tint, 20 % on hover) holding `MdSatellite` in primary blue, followed by the bold text **"GVMC"** (`--font-sm`, letter-spacing 0.02em).
- **Container `.navbar`:**
  - `position: fixed; top: 16px; left: 50%; transform: translateX(-50%)`
  - `width: min(calc(100% - 32px), 920px); height: 60px`
  - white background, `1px var(--glass-border)`, `border-radius: 9999px`
  - `display: grid; grid-template-columns: auto 1fr auto` (brand | centred links | end)
  - `z-index: var(--z-fixed)`, `--shadow-sm`
  - **Scrolled** (`scrollY > 8`, via framer `useScroll` + `useMotionValueEvent`): border becomes `--border-color` and the shadow becomes `--shadow-lg`
- **Link `.navbar__link`:**
  - pill shape, `padding: var(--space-2) var(--space-3)`, `--font-sm`, medium weight, `--text-secondary`
  - hover: `--bg-hover` background
  - **Active:** a `motion.span` with `layoutId="navbar-active-pill"` fills the link, `background: var(--text-primary)` (near-black), and the label turns white. The pill animates between links.
- **End slot:** `<DemoModeBadge/>` (a warning "Demo Mode" badge unless `dataMode === 'live'`) plus a hamburger button.
- **≤ 768px:**
  - width `calc(100% - 24px)`; the brand text and inline links are hidden
  - a 44×44 hamburger (`FiMenu` / `FiX`) toggles:
    - a **backdrop** (`fixed; inset:0; --bg-overlay; z-index: --z-modal-backdrop`) that closes the menu on click
    - a **drawer** (a `.glass-panel`, fixed 8px below the navbar, left and right 12px, column of links at `min-height: 48px`, `--font-md`; the active link is near-black with white text). It animates `opacity/y -8 → 0` over 0.2s.

### 7.3 App splash (`components/AppSplash.jsx`)
A full-screen white overlay (`fixed; inset:0; z-index: --z-modal`), centred column:
- **Scanner tile:** 96×96px, `--bg-secondary`, 1px border, radius `--radius-md`
  - a grid background: 24px lines in `--border-color-light` at 0.7 opacity
  - a 2px **scanline** (`linear-gradient(90deg, transparent, primary, transparent)`) that animates `translateY(0 → 94px)` over **1.6s**, infinitely, fading in and out
  - four 10px L-shaped **corner brackets** in primary blue at 0.45 opacity
- **Label:** `MdSatellite` (primary) + **"GVMC Detection"** (`--font-md`, semibold)
- **Hint:** "Preparing satellite intelligence…" (`--font-xs`, muted, `role="status"`)
- **Exit:** opacity → 0 over 0.35s

### 7.4 Utility components
- **PageMotion** `({className, children})`: a `motion.div` that fades in over 0.25s. Every view's root element is a PageMotion carrying the page class.
- **ScrollToTop:** calls `window.scrollTo(0,0)` whenever `pathname` changes.
- **GoogleMapsProvider:** `<APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}>`.
- **Loader** `({size='md'|'sm'|'lg', label='Loading'})`: three dots, 6px (4px for sm, 8px for lg), primary colour, `pulse-fade 1s` staggered 0.15s and 0.3s; `role="status"`, `aria-label`.
- **EmptyState** `({icon: Icon, message, actionLabel?, onAction?})`: centred column, padding `space-6 space-4`, a 1.75rem muted icon, `--font-sm` muted message (max-width 260px), optional outlined action button.

---

## 8. Pages

### 8.1 `/` — HomePage (role launcher)
```
            GVMC · PS 26013 NAKSHA                     ← .view-kicker (blue, uppercase)
 Multi-source geospatial harmonization for             ← h1, --font-2xl bold, -0.02em
          Visakhapatnam's 98 wards
          Select a workspace to continue               ← subtitle, --font-md secondary

 ┌──────────────────────────────────────────────────┐
 │ [📍]  Field Officer                            → │  ← launcher row (max-width 720px)
 │       Verify unverified parcels on the map, …    │
 └──────────────────────────────────────────────────┘
   … 4 more rows …
```
- The page is a centred flex column with `min-height: calc(100vh - var(--nav-offset))` and padding `space-8 page-padding-x`. The hero is max 640px wide with margin-bottom `space-7`.
- **Rows (exact copy + accent + icon):**

| Path | Icon | Title | Description | Accent |
|---|---|---|---|---|
| `/officer` | `FiMapPin` | Field Officer | Verify unverified parcels on the map, review satellite evidence, and update land record status. | `--color-primary` |
| `/supervisor` | `FiUsers` | Supervisor | Monitor ward-level stats, review AI-generated alerts, and export ward reports. | `--color-success` |
| `/commissioner` | `FiBarChart2` | Commissioner | City-wide heatmap, top unverified wards, compliance estimates, and AI daily brief. | `--color-warning` |
| `/integration` | `FiLayers` | Integration | Ingest multi-source geospatial data, run spatial matching, and resolve harmonization conflicts. | `--color-info` |
| `/admin` | `FiSettings` | Admin Panel | Upload GVMC property CSV, configure database, adjust detection threshold, trigger pipeline. | `--color-danger` |

- **Row `.launcher-row`:**
  - white, 1px border, radius `--radius-xl`, padding `space-4 space-5`, gap `space-4`
  - entrance `fadeInUp` with a 60ms × index stagger
  - **Hover:** the border takes the accent colour, `--shadow-md`, `translateX(4px)`; the icon tile goes from 12 % to 20 % accent; an `FiArrowRight` fades and slides in, tinted with the accent
- **Icon tile:** 44×44, radius `--radius-lg`, 1.25rem icon in the accent colour
- The whole row is clickable (`navigate(path)`)
- **≤ 600px:** title `--font-xl`, row padding `space-3 space-4`, 36px icon tile, arrow hidden

### 8.2 `/officer` — FieldOfficerView
```
┌───────────────────────── map (flex 3) ─────────────────────────┐ ┌──── glass side panel (flex 2, 360–600px) ───┐
│                                                                │ │ Field Officer          Ward [— Select… ▾]   │
│   Google Map (heatmap circles when a ward is selected)         │ │ ─ COMPARISON ─────────────────────────────── │
│                                                                │ │ Base Year [2022▾]   Compare With [2024▾]    │
│                                                                │ │ [24 New Structures][9 Change of Use] …(2×3) │
│                                                                │ │ ─ ANALYTICS ──────────────────────────────── │
│                                                                │ │ (•Total Detections 12)(•New Builds 7)…pills │
│ ┌ legend ┐                                                     │ │ ─ PROPERTIES ─────────────────────────────── │
│ └────────┘                                                     │ │ [All Types▾][All Statuses▾]   12 properties │
└────────────────────────────────────────────────────────────────┘ │ ID │ Type │ Area │ Conf │ Status (260px tall)│
                                                                   │ ConfidenceCard / VerifyPanel / Raise Ticket │
                                                                   └─────────────────────────────────────────────┘
                                                                                             [💬 AI Assistant] ← fixed bottom-right
```
- **Root `.officer-view`:** `display:flex; height: calc(100vh - var(--nav-offset)); overflow:hidden; gap: space-4; padding: space-4`.
- **Map box:** `flex: 3 1 0`, radius `--radius-xl`, 1px border, `overflow:hidden`. It renders `<MapView heatmap={!!selectedWardId} />`.
- **Side panel `.officer-view__overlay`:** `flex: 2 1 0; min-width: 360px; max-width: 600px`, glass styling. Inside, `.officer-view__toolbar` scrolls vertically (`overflow-y:auto`, padding `space-3`, gap `space-2`).
- **Contents, top to bottom:**
  1. **Topbar:** h1 "Field Officer" (`--font-lg`, semibold) and `<WardSelector compareYear={compareYear}/>`, space-between, wrapping.
  2. **Error banner** (`.view-error-banner`): "Failed to load data: {error}" (from the properties or wards error).
  3. `<ComparisonControls baseYear compareYear onBaseYearChange onCompareYearChange/>`.
  4. **Section "Analytics"** (heading: uppercase `--font-xs` muted, letter-spacing 0.08em, top border `--border-color-light`): `<StatsBar variant="badge"/>`.
  5. **Section "Properties":** `<PropertyList/>`, fixed at **260px** tall inside this panel, transparent, no border.
  6. **Selected property detail** (`AnimatePresence mode="wait"`, keyed by id):
     - **Normal mode:** `<ConfidenceCard/>`, `<VerifyPanel/>`, then a full-width button "Raise a Ticket". After a ticket is submitted the button reads "Ticket Raised", turns green (`status-success` colours) and is disabled.
     - **Ticket mode:** `<RaiseTicketPanel onBack onSuccess/>`.
     - When a property is selected, the detail scrolls into view (`scrollIntoView({behavior:'smooth', block:'nearest'})` after 120ms).
  7. `OfficerAssessmentForm` exists but is **commented out**.
- **Toast:** "Ticket submitted successfully." appears centred at the top of the panel (success colours, `--shadow-md`) for 3s after a ticket is submitted.
- `<ChatPanel/>` floats fixed at the bottom-right.
- **Year logic:** years come from `COMPARISON_YEARS = [2022, 2024, 2026]`. The defaults are base 2022 and compare 2024.
  - If the base year changes to one ≥ the compare year, compare moves to the next later year.
  - If compare changes to one ≤ the base year, base moves to the previous year.
  - Changing the compare year re-fetches `fetchProperties({wardId, compareYear})`, but not on the first render.
- Changing the selected property resets ticket mode, the "raised" flag and the toast.
- **≤ 1024px:** the page stops being fixed-height and stacks:
  - the map becomes a box `clamp(280px,45vh,420px)` tall with page margins
  - the panel becomes full-width and static; the toolbar itself becomes the glass card
  - stats cards and table cells get more padding

### 8.3 `/supervisor` — SupervisorView
```
SUPERVISOR WORKSPACE                                  Ward [ … ▾ ]  [⬇ Export CSV]
Ward Oversight  [🔔 Pending Assessments (0)]
──────────────────────────────────────────────────────────────────────────────
(PendingAssessmentsTable — only when the badge is toggled open)
┌ Field Tickets  [3 open][1 resolved]                       [All Statuses ▾] ┐
│ Ward │ House No. │ Description │ Tax Pending │ Status │ Date │ [Review]    │
└────────────────────────────────────────────────────────────────────────────┘
┌ AI ALERTS                                         (3) [+ Generate]         ┐
│ [danger] 2 hours ago — text…                                               │
└────────────────────────────────────────────────────────────────────────────┘
[ Total Detections ][ New Builds ][ Change of Use ][ Pending Verification ]  ← StatsBar cards
┌ PropertyList (height: calc(100vh - nav - 260px), min 300px) ───────────────┐
```
- The root has `min-height: calc(100vh - nav-offset)`. Content is a `.view-container` (max 1800px) with padding `space-6 page-padding-x page-padding-y`.
- **Header:** flex, space-between, aligned to the end, margin-bottom `space-6`.
  - Left: kicker "Supervisor Workspace", then a row with h1 **"Ward Oversight"** (`--font-xl` bold, -0.015em) and `<PendingAssessmentsBadge open onToggle/>`.
  - Right: `<WardSelector/>`, then the **Export CSV** button (`FiDownload` 14px; `--bg-secondary`, 1px border, radius md; hover turns the border and text primary). While exporting it reads "Exporting…". On success it opens the returned URL in a new tab.
- **Body:** a single-column grid (`minmax(0,1fr)`), gap `space-4`, in this order: TicketsList, AlertPanel, StatsBar (card variant), PropertyList.
- **Error banner:** "Failed to load data: {propertiesError}".

### 8.4 `/commissioner` — CommissionerView
```
┌──────────────────────── map (flex 1, choropleth) ───────────────────────┐ ┌─ glass panel clamp(380px,30vw,450px) ─┐
│  ward bbox rectangles coloured by avg NDBI Δ; click → InfoWindow        │ │ ┌ Top 10 Wards by Unassessed ───────┐ │
│                                                                         │ │ │ # │ Ward │ Unassessed │ Det. │ Open│ │
│ ┌ NDBI ACTIVITY legend ┐                                                │ │ └────────────────────────────────────┘ │
│ └──────────────────────┘                                                │ │ ┌ AI Daily Brief ───────────────────┐ │
└─────────────────────────────────────────────────────────────────────────┘ │ │ (markdown)                         │ │
                                                                            │ └────────────────────────────────────┘ │
                                                                            └────────────────────────────────────────┘
```
- The layout is the same idea as Officer: a fixed-height flex row, the map `flex:1`, and the panel `flex: 0 0 clamp(380px, 30vw, 450px)` in glass.
- The panel's toolbar (kicker "City-Wide View" + h1 "Commissioner Overview") is **hidden on desktop** and shown at ≤ 1024px.
- On mount it dispatches `fetchAllWardsStats()` and `fetchCommissionerBrief()`, but only when each is still `idle`.
- **Card "Top 10 Wards by Unassessed":**
  - white card, radius lg, padding `space-4`; the section title is `--font-md` semibold with a bottom border
  - table has `min-width: 420px` and uses `--font-sm`; headers are uppercase `--font-xs` secondary; rows get `--bg-hover` on hover
  - columns: `#` (muted rank), Ward (`wardName ?? "Ward {id}"`), Unassessed, Detections, Open Tickets (a danger badge if > 0, else "—"). Numeric columns are right-aligned and use `toLocaleString()`.
  - rows are sorted by `unassessedCount` descending, then sliced to 10
  - **Loading:** 5 skeleton rows. **Empty:** `EmptyState` with `FiBarChart2` and "No data. Ward stats will appear after pipeline runs."
- **Card "AI Daily Brief":**
  - **Loading:** 3 skeleton lines, the last at 55 % width.
  - **Failed:** italic "{error}" or "AI brief unavailable. Try refreshing."
  - **Success:** `<ReactMarkdown>` rendering `aiBrief`.
  - **Empty:** "AI brief will appear here once the pipeline has run."
- **≤ 1024px:** stacked, the same way as Officer.

### 8.5 `/integration` — IntegrationView
```
PS 26013 NAKSHA                      [Master parcels ▾] [⬇ GeoJSON] [⬇ CSV]  Ward [ … ▾ ]
Multi-Source Integration
(export message banner)
┌ DATA SOURCES ──────────┐ ┌ SPATIAL MATCHES      Min score [──●─] 0  [▶ Run Matching] ┐ ┌ CONFLICTS (3) ─────────┐
│ [cadastral ▾][⬆Choose  │ │ 6 matches, 3 conflicts from 8 sources                    │ │ ▌⚠ geometry mismatch    │
│  file][Upload]         │ │ SOURCE A │ SOURCE B │ IOU │ DIST(M) │ SCORE │ CONFIDENCE │ │ │  [high]                 │
│ (All)(cadastral)(rev…) │ │ cadastral│municipal │0.91 │   2.3   │[████96.1]│97 auto-acc│ │ │  suggested resolution… │
│ ┌ file.geojson ───────┐│ │ …                                                         │ │ │  [pending] [✓ Mark     │
│ │ [cadastral] [ready] ││ │                                                           │ │ │            resolved]   │
│ └─────────────────────┘│ └───────────────────────────────────────────────────────────┘ └─────────────────────────┘
└────────────────────────┘
```
- The content is a `.view-container` with padding `space-4 space-3`. The header shows kicker "PS 26013 NAKSHA" and h1 "Multi-Source Integration" (`--font-xl`, 700).
- **Header actions:**
  - export layer `<select>` (`EXPORT_LAYERS`)
  - "GeoJSON" and "CSV" buttons (`FiDownload` 13px)
  - `<WardSelector/>`
  - Result message banner: "Exported {n} features" (with " (truncated — narrow by ward)" when truncated), "Exported {n} rows", or the error message.
- **Grid:** `grid-template-columns: 1fr 1.4fr 1fr`, gap `space-3`, `align-items:start`; 2 columns at ≤ 1100px and 1 at ≤ 700px. Each column is a `.glass-panel` with padding `space-3` and radius lg.
- **Panel titles:** `--font-sm`, 700, uppercase, 0.05em, secondary colour.
- On mount, and whenever the ward changes, it fetches sources, matches and conflicts (`ward_id` is optional).

**Data Sources panel**
- **Upload form:**
  - a type `<select>` of `SOURCE_TYPES` (underscores shown as spaces): `cadastral, revenue, municipal_gis, utility, drone_imagery, ori, dsm_dtm, ground_truth, gnss_cors, building_footprint`
  - a "Choose file" label-button with a hidden `<input type=file accept=".geojson,.json,.pdf,.jpg,.jpeg,.png,.tiff,.tif,.csv,.shp">`
  - a primary **Upload** button ("Uploading…" while busy)
- **Upload behaviour:** `FileReader.readAsDataURL`, strip the prefix to get base64, dispatch `uploadSource({fileContent, type, wardId, filename})`, then reset status, refetch sources and clear the input. Errors appear in red `--font-xs`.
- **Filter chips:**
  - "All" plus the first 6 source types
  - pill shape, 11px, `--bg-secondary`
  - active chip: `--color-primary-light` background, primary border and text, 600 weight
  - clicking the active chip toggles it off
- **Source list:** max-height 420px, scrolls.
  - Each item has padding 8/10, a 1px border, radius md and `--bg-secondary`.
  - Name: `filename` or the last part of `s3Key`; `--font-xs` 600, ellipsis.
  - Meta: a type tag (10px, primary-light background, primary-dark text, capitalised) plus a status badge. Status → class: `ready→success, processing→secondary, pending_ocr→warning, failed→danger`.
  - Empty: "No sources found". Loading: `<Loader/>`.

**Spatial Matches panel**
- **Header:**
  - "Min score" range 0–100, step 5, 60px wide, `accent-color` primary, shows its value
  - primary **Run Matching** button (`FiPlay`; "Running…" while busy)
  - after a run it refetches matches and conflicts
- **Run result banner** (primary-light background, primary-dark text): "{matches_created} matches, {conflicts_created} conflicts from {sources_evaluated} sources".
- **Table** (`--font-xs`; headers 10px/700 uppercase):
  - Source A and Source B as type tags
  - IoU `toFixed(2)`, Dist (m) `toFixed(1)` (right-aligned, tabular)
  - **Score** as a `MatchScoreBar`:
    - 16px tall, min 80px wide, radius 8, `--color-gray-200` track
    - fill colour by score: ≥ 90 success, ≥ 70 warning, ≥ 40 `#fd7e14`, else danger
    - label shows the value to 1 decimal, 10px bold
  - **Confidence:** `confidenceScore` to 0 decimals, plus a band badge: `auto_accept → "auto-accept" success`, `review → warning`, `conflict → danger`
  - rows are filtered client-side by `matchScore >= minScore`
  - empty: "No matches"

**Conflicts panel**
- The title shows a red count badge (18px round, 10px bold white) when there are any conflicts.
- **Each conflict card:**
  - padding 10/12, radius md, **3px left border**, background tinted by severity:
    - `critical → danger` (`FiAlertOctagon`)
    - `high → warning` (`FiAlertTriangle`)
    - `medium → orange` (`#fff3e0` / `#fd7e14`, `FiAlertTriangle`)
    - `low → info` (`FiInfo`)
  - header: icon, conflict type (capitalised, underscores → spaces), severity badge
  - body: `suggestedResolution` (11px secondary)
  - footer: a status badge (success if resolved, else secondary); when unresolved, a small "Mark resolved" button (`FiCheckCircle`) that dispatches `resolveConflict({id, status:'resolved', resolvedBy:'officer'})`
- The list is max 500px tall and scrolls. Empty: "No conflicts".

### 8.6 `/admin` — AdminPanel
```
SYSTEM CONFIGURATION                                            [Demo Mode]
Admin Panel
────────────────────────────────────────────────────────────────────────────
┌ 01 [⬆] Upload GVMC Property Data ─────────────────────────────────────────┐
│ [Choose file .csv]  [Upload CSV]                                           │
│ ✓ Data loaded successfully. 1,847 properties imported.                     │
└────────────────────────────────────────────────────────────────────────────┘
┌ 02 [🗄] Database Configuration ────────────────────────────────────────────┐
│ Host     [rds-endpoint.ap-south-1.rds.amazonaws.com]                       │
│ Port     [3306] · Database [gvmc_sw14] · Username [admin] · Password [•••] │
│ [Save Config]  Saved.                                                      │
└────────────────────────────────────────────────────────────────────────────┘
┌ 03 [↻] Detection Pipeline ─── Status [idle]  Last refresh 30 Jul 2026 04:00 ┐
│ [↻ Trigger Refresh]                                                          │
└──────────────────────────────────────────────────────────────────────────────┘
┌ 04 [⎚] Detection Sensitivity ── NDBI Threshold: 0.15 ─────────────────────┐
│ [────●──────────]  0.05 (sensitive) … 0.30 (strict)   [Save Threshold]     │
└────────────────────────────────────────────────────────────────────────────┘
```
- **Content:** max-width 1280px, centred, padding `space-6 clamp(24px,4vw,48px) page-padding-y`.
- **Header:** kicker "System Configuration", h1 "Admin Panel" (`--font-xl` bold), and a status badge: "Live Data" (success) or "Demo Mode" (warning). A bottom border sits under the header.
- **Sections:** a column with gap `space-6`. Each `.admin-section` is white, radius xl, 1px border, padding `space-6`, `--shadow-sm` (md on hover).
  - Section head: a big number "01"–"04" (`--font-xl` bold, coloured `--border-color`, so it looks faint), a 36px icon tile (primary 10 % tint), and the title (`--font-md` semibold).
  - Fields use a 2-column grid: `minmax(100px,140px) 1fr`. Inputs use `--bg-secondary`, radius md, and a focus ring (`--shadow-focus`).
  - Buttons are primary or secondary. The inline messages "Saved." and "Failed to save." clear after 3s.
- **01 CSV upload:**
  - file input `accept=".csv"` and **Upload CSV** ("Uploading…"); disabled until a file is chosen
  - sends `FormData('file')` to `uploadCSV`
  - success message "Data loaded successfully. N properties imported."; on success `dataMode` becomes `'live'`
- **02 DB config:** fields Host, Port (default `'3306'`), Database, Username, Password, then **Save Config**, which calls `saveDbConfig(form)`.
- **03 Pipeline:**
  - status badge: `idle→secondary, running→info, completed→success, failed→danger`
  - "Last refresh" formatted `DD MMM YYYY HH:mm`
  - **Trigger Refresh** (the icon spins while running); disabled while running
  - while `running`, it polls `fetchAdminConfig()` every **10s**
- **04 Threshold:**
  - "NDBI Threshold: **0.15**" label
  - range 0.05–0.30, step 0.01, with hints "0.05 (sensitive)" and "0.30 (strict)"
  - **Save Threshold** calls `saveDbConfig({ ndbi_threshold })`

---

## 9. Component reference

> "Reads" = Redux selectors, "Dispatches" = actions/thunks. All components are default exports unless noted.

### MapView `({ choropleth=false, allWardsData=null, heatmap=false })`
- **Structure:** `.map-view` (relative, 100 %) holds a loading overlay, a `<Map>` containing `<MapContent/>` (which renders nothing but draws on the map), and a legend.
- **Map props:**
  - `defaultCenter={{lat: 17.6869, lng: 83.2185}}` (Visakhapatnam), `defaultZoom={12}`
  - `gestureHandling="greedy"`, `disableDefaultUI={false}`
  - optional `mapId` from `VITE_GOOGLE_MAPS_MAP_ID`
  - `style={{width:'100%',height:'100%'}}`
- **Reads:** `selectWardGeoJSON, selectGeoJSONStatus, selectSelectedWard, selectWards, selectProperties, selectSelectedProperty`. **Dispatches:** `setSelectedProperty(id)`.
- **Effects inside `MapContent`** (via `useMap()`):
  1. **Fit ward:** when `selectedWard.bbox {north,south,east,west}` changes, call `map.fitBounds(new LatLngBounds({south,west},{north,east}))`.
  2. **Detection polygons** (`map.data.addGeoJson(wardGeoJSON)`), active when `showPolygons` is on:
     - fill colour: the review status colour, else by type — `new_build #dc3545`, otherwise `#ffc107`
     - `REVIEW_COLORS = { underassessed:'#fd7e14', already_assessed:'#28a745', false_positive:'#6c757d' }`
     - opacity: selected 0.85, else confidence ≥ 0.8 → 0.6, ≥ 0.5 → 0.4, else 0.2
     - stroke: white 3px when selected, else the fill colour at 2px
     - clicking a feature dispatches `setSelectedProperty(feature.id)`
     - features and the listener are cleaned up each run
  3. **Choropleth** (`choropleth && allWardsData && wards`):
     - one `google.maps.Rectangle` per ward bbox, `fillColor = ndbiColor(avgNdbiDelta)`, fillOpacity 0.35, stroke opacity 0.6 at 1px
     - clicking opens an InfoWindow listing the ward name, Avg NDBI Δ and Max NDBI Δ (3 decimals) and Detections
  4. **Heatmap** (`heatmap && properties`):
     - one `google.maps.Circle` per property at its lat/lng, radius `max(18, sqrt(areaSqm ?? 100) * 2.5)` metres, colour `ndbiColor(ndbiDelta)`
     - fill opacity 0.65 (0.9 when selected), stroke weight 1 (2.5 when selected), zIndex 3 (10 when selected)
     - clicking opens an InfoWindow (id, NDBI Δ, type, area m², "baseline–comparison" years) and selects the property
- **Colour function:**
  ```js
  function ndbiColor(delta) {
    if (delta >= 0.3) return '#c0392b';
    if (delta >= 0.2) return '#e67e22';
    if (delta >= 0.1) return '#f1c40f';
    if (delta > 0)   return '#f9e79f';
    return '#ecf0f1';
  }
  ```
- **Legends** (absolute, bottom-left `space-4`, white card, radius md, `--shadow-md`, `--font-xs`, min-width 140; title uppercase 600; 14px swatches with radius 3):
  - **Polygon mode** ("Review status"):
    - New build — unreviewed `#dc3545`
    - Other change — unreviewed `#ffc107`
    - Underassessed `#fd7e14`
    - Already assessed `#28a745`
    - False positive `#6c757d`
  - **Choropleth / heatmap** (title "NDBI Activity" or "NDBI Delta"):
    - ≥0.30 High
    - ≥0.20 Moderate
    - ≥0.10 Low
    - <0.10 Minimal
    - No data
    - The swatches use the `--ndbi-*` tokens.
- **Loading overlay** (while the GeoJSON is loading): `--glass-bg-soft` with an 8px blur, then `<Loader size="lg"/>` and "Loading ward data…".
- A "Hide/Show Change Polygons" toggle exists but is commented out.

### WardSelector `({ compareYear })`
- **Layout:** label "Ward", then a select wrapper (min 240px) with a native `<select>` (`appearance:none`, `--bg-secondary`, radius lg, padding right `space-6`) and an absolutely placed `FiChevronDown` in muted colour.
- **Options:** "— Select a ward —" (or "Loading wards…"), then `Ward {id} — {name}` plus ` ({n} detections)` when n > 0.
- On mount it fetches the wards if `status==='idle'`.
- **On change:** `setSelectedWard(id)`, `fetchProperties({wardId, compareYear})`, `fetchStats({wardId})`. (`fetchWardGeoJSON` is disabled.)
- Hover and focus turn the border primary; focus adds the focus ring.

### StatsBar `({ variant='card'|'badge' })`
- **Reads:** `selectWardStats, selectStatsStatus`.
- **Items:**
  - `totalDetections` "Total Detections" (primary)
  - `newBuilds` "New Builds" (danger)
  - `changeOfUse` "Change of Use" (warning)
  - `pendingVerification` "Pending Verification" (info)
- **Card variant:**
  - grid `repeat(auto-fit, minmax(160px,1fr))`, gap `space-3`
  - each card is white, radius lg, padding `space-4`, and lifts 2px on hover with an accent-tinted border
  - value: `--font-xl`, bold, tabular
  - label: uppercase `--font-xs` with a 6px accent dot
  - shows skeletons while loading and "—" when there are no stats
- **Badge variant:** a wrapping flex row of pills (`--bg-secondary`, 1px border): dot, label, then the bold value.

### ComparisonControls `({ baseYear, compareYear, onBaseYearChange, onCompareYearChange })`
- Heading "Comparison", then a 2-column grid: "Base Year" select and "Compare With" select.
  - Base-year options ≥ compareYear are disabled; compare-year options ≤ baseYear are disabled.
- Below: a 2-column grid of 6 stat cards from `getComparisonStats(base, compare)`:
  - New Structures (danger)
  - Change of Use (warning)
  - Built-up Area + (primary, suffix " m²")
  - Assessable Area (info, " m²")
  - Avg NDBI Change (purple, prefix "+", 2 decimals)
  - Tax Impact (success, prefix "₹")

### PropertyList
- **Reads:** `selectProperties, selectPropertiesStatus, selectSelectedProperty`.
- **Filters row:**
  - type select (All Types / New Build / Change of Use)
  - status select (All Statuses / Pending / Verified / Underassessed / False Positive / Already Assessed)
  - a right-aligned count "{n} properties"
- **Table:** min-width 600px, sticky uppercase headers.
  - Columns: ID (monospace, first 8 characters + "…"), Type badge (`new_build` → danger "New Build", otherwise orange "Change of Use"), Area (m²), Confidence (`round(c*100)%`), Status badge.
  - Status → class: `pending→secondary, verified→success, underassessed→warning, false_positive→danger, already_assessed→info`.
- **Row click:** `setSelectedProperty(id)`, then `fetchPropertyById(id)` and `fetchPropertyExplanation(id)`.
- The selected row gets a `--color-primary-light` background and an inset 3px primary left bar. Rows fade up with a 30ms stagger (capped at 300ms).
- **Loading:** 6 shimmer rows. **Empty:** `EmptyState(FiMapPin)`, "Select a ward to load properties." or "No matching properties."

### ConfidenceCard
- **Reads:** `selectSelectedProperty, selectExplanationStatus, selectExplanationError`. Renders nothing when no property is selected.
- **Header:**
  - left: "CONFIDENCE" label with a large percentage (`--font-2xl` bold, coloured by `signalColor`)
  - right: type badge and "{area} m²"
- **Five signal bars** (from `confidenceBreakdown`, values 0–1): `ndbi_delta` "NDBI Delta", `area_delta` "Area Expansion", `osm_status` "OSM Status", `ndvi_drop` "Vegetation Drop", `db_match` "DB Match". Each is a label + % row above a 6px track.
- **Colour rule:** `signalColor(v)`: ≥ 0.7 success, ≥ 0.4 warning, else danger.
- **AI block:**
  - loading: `<Loader size="sm"/>` + "Loading AI explanation…"
  - failed: error text or "AI explanation unavailable."
  - success: "AI ANALYSIS" label + `<ReactMarkdown>{aiExplanation}</ReactMarkdown>`

### VerifyPanel
- **Header:** "VERIFICATION" and the current status badge.
- **Four buttons** in a 2×2 grid, each tinted with its status colours:
  - Verified (success)
  - Underassessed (warning)
  - False Positive (danger)
  - Already Assessed (info)
- The button for the current status is disabled and shows a `0 0 0 2px currentColor` ring. While verifying, the other buttons show a spinner.
- A click dispatches `verifyProperty({id, status, updatedBy:'officer'})`.
- **Feedback:** "Status updated successfully." (success) or the error text, animated.

### RaiseTicketPanel `({ onBack, onSuccess })`
- **Header:** back button (`FiArrowLeft`) and "Raise a Ticket".
- **Form:**
  - Ward (disabled, shows the ward name)
  - **House Number\*** (placeholder `e.g. 12-4-56/A`)
  - **Description\*** (textarea, 3 rows, "Describe what you observed…")
  - Tax Pending (₹) *optional* (number, e.g. 25000)
  - Photograph *optional*: an upload button that accepts `image/jpeg,image/png,image/heic,image/webp`
- **Photo flow:**
  1. `getPhotoUploadUrl(filename)` returns `{upload_url, s3_key}`.
  2. `fetch(upload_url, {method:'PUT', body:file, headers:{'Content-Type': file.type}})`.
  3. Then "Photo ready", or "Failed to get upload URL." / "Photo upload failed."
- **Submit "Submit Ticket":** `createTicket({wardId, propertyId, houseNumber, description, taxPending, photoS3Key})`. On `succeeded` it resets the status and calls `onSuccess`. Errors appear animated.

### ChatPanel
- A fixed container at the bottom-right (`z-index: --z-modal`, `pointer-events:none`; its children are clickable).
- **Toggle pill:** primary blue with white text, `FiMessageSquare` + "AI Assistant", or `FiX` + "Close Chat".
- **Window:**
  - `width: min(360px,100%); max-height: min(520px,70vh)`, white, radius lg, `--shadow-lg`
  - a primary header: "AI Field Assistant"
  - welcome text (italic muted): "Ask me about flagged properties, ward statistics, or next steps."
  - **Bubbles** (max 85 % wide):
    - user bubbles sit on the right, primary with white text, with a 4px bottom-right corner
    - assistant bubbles sit on the left, `--bg-secondary`, 4px bottom-left corner, rendered as markdown
  - typing indicator: 3 bouncing dots
- **Input row:** textarea "Ask a question…" plus a send button (`FiSend`). **Enter** sends; **Shift+Enter** adds a newline. It auto-scrolls to the bottom.
- **Dispatches:** `sendChatMessage(text)`.

### AlertPanel
- Renders only when a ward is selected. On a ward change it resets the generate status and calls `fetchAlerts(wardId)`.
- **Header:** "AI ALERTS", a count pill (primary), and an outlined pill button **"+ Generate"** ("Generating…") that calls `generateWardAlert(wardId)` via the agent API and then refetches.
- **Generate feedback** strip: severity and text, tinted by severity.
- **Alert cards:** max-height 280px, scrolls.
  - Each card: a severity badge (`info/warning/danger` or `LOW/MEDIUM/HIGH` → `info/warning/danger`), relative time ("2 hours ago"), and the text.
  - 3 skeleton cards while loading. Empty: `EmptyState(FiBellOff)` "No alerts for this ward."

### TicketsList
- Fetches `fetchTickets({wardId?, status?})` whenever the ward or the status filter changes.
- **Header:** "Field Tickets", a danger badge "{n} open", a success badge "{n} resolved", and a status filter (All / Open / Under Review / Resolved).
- **Table columns:**
  - Ward
  - House No.
  - Description (truncated to 60 characters with "…")
  - Tax Pending (`₹` + `en-IN`, right-aligned)
  - Status badge (`open→danger "Open"`, `under_review→warning "Under Review"`, `resolved→success "Resolved"`)
  - Date (`en-IN`)
  - a **Review** button that opens `TicketReviewModal`
- **Loading:** 3 skeleton rows. **Empty:** `EmptyState(FiFileText)` "No tickets found for this ward."

### TicketReviewModal `({ ticket, onClose })`
- **Overlay:** fixed, `rgba(0,0,0,0.45)`, centred; clicking outside closes it. The panel is a `.glass-panel`, max-width 480px, max-height 90vh, padding `space-5`, and scales in.
- **Detail box** (`--bg-secondary`): rows of uppercase label and value for Ward, House No., Status badge, Tax Pending, "Raised on" (`toLocaleString('en-IN')`), Description, and Photograph (image, max-height 200).
- **Form:**
  - "Update Status": 2 toggle buttons, Under Review (warning, the default) and Resolved (success)
  - "Supervisor Notes" textarea, "Add review notes…"
  - **Save Review** calls `reviewTicket({ticketId, status, supervisorNotes})`
  - on success it shows "Review saved." and closes after 1.5s; it resets the status on unmount

### PendingAssessmentsPanel
- **Named export `PendingAssessmentsBadge({open, onToggle})`:**
  - a pill button `FiBell` "Pending Assessments ({count})"; active styling when open
  - when `lastSubmittedId` changes it shows the toast "🔔 New Assessment Submitted" for 4s
- **Default export `PendingAssessmentsTable`** (reuses the `property-list__*` table classes):
  - columns: Property, Ward, Officer, Submission Time (`DD MMM, HH:mm`), Estimated Tax (₹), Status (`pending_review→warning "Pending Review"`, `reviewed→success "Reviewed"`), and Actions ("Mark Reviewed" → `updateAssessmentStatus`)
  - empty: `EmptyState(FiBell)` "No assessments submitted yet."

### OfficerAssessmentForm `({ baseYear, compareYear })` — built but not mounted
- A collapsible form (`FiClipboard`) prefilled from the selected property.
- **Read-only comparison context:**
  - NDBI change (`breakdown.ndbi_delta`, default 0.18)
  - area difference `round(areaSqm * area_delta)`
  - confidence, detection type, coordinates (default "17.68690, 83.21850")
- **Fields:**
  - Property ID (default `GVMC-000-0000`), Owner Name, Door Number, Survey Number, Locality
  - Construction Type: `Residential | Commercial | Mixed Use | Industrial`
  - Floors, Built-up Area m², Newly Constructed Area m²
  - Violation Type: `Unauthorized Construction | Change of Land Use | Building Extension | Commercial Conversion | Other`
  - Officer Remarks, Estimated Tax Impact ₹, Estimated Penalty ₹
  - Recommended Action: `Verify | Issue Notice | Immediate Inspection | Demolition Review | Escalate`
- **Submit** dispatches `submitAssessment(...)` (local-only, see §10).

### DemoModeBadge
Renders `<span className="status-badge status-badge-warning" role="status">Demo Mode</span>` unless `selectDataMode === 'live'`.

---

## 10. State management (Redux)

### Store (`Redux/Store.jsx`)
```js
configureStore({
  reducer: { wards, properties, stats, admin, chat, alerts, assessments, tickets, sources, harmonization, conflicts },
  middleware: (gdm) => gdm({ serializableCheck: false }),
});
```

### Conventions
- Status values are `'idle' | 'loading' | 'succeeded' | 'failed'`, with separate status fields per operation (for example `verifyStatus` and `uploadStatus`).
- Thunks use `createAsyncThunk` and `rejectWithValue(err.response?.data?.message ?? err.message)`. The agent API thunks use `…?.detail`.
- `mapAPIToUI` converts API snake_case to UI camelCase; `mapUIToAPI` does the reverse.
- Components read state **only** through exported selectors.
- Most slices export `clearErrors` and one or more `reset*Status` actions (not `chat` or `assessments`).

### Slices

**wards**
- **State:** `{ items:[], selectedWardId:null, wardGeoJSON:null, status, geoJSONStatus, error }`
- **Thunks:**
  - `fetchWards()`: `GET /api/wards` returns an array
  - `fetchWardGeoJSON(id)`: `GET /api/wards/{id}/changes` returns `{presigned_url}`; the thunk then `fetch()`es that URL for the GeoJSON
- **Reducers:** `setSelectedWard(id)` also clears the GeoJSON.
- **Selectors:** `selectWards, selectSelectedWardId, selectSelectedWard, selectWardGeoJSON, selectWardsStatus, selectGeoJSONStatus, selectWardsError`
- **Map:** `{ id, name, bbox:{north,south,east,west}, geojson_s3→geojsonS3, detection_count→detectionCount }`

**properties**
- **State:** `{ items, selectedItem, status, fetchOneStatus, explanationStatus, explanationError, error, verifyStatus, verifyError }`
- **Thunks:**
  - `fetchProperties({wardId,type,status,compareYear})`: `GET /api/wards/{id}/unassessed?type&status&comparison_year`, returns an array
  - `fetchPropertyById(id)`: `GET /api/properties/{id}`
  - `fetchPropertyExplanation(id)`: **agentApi** `GET /api/explain/{id}` returns `{ai_explanation}`
  - `verifyProperty({id,status,notes,updatedBy})`: `POST /api/properties/{id}/verify {status, notes, updated_by}`
- **Reducers:** `setSelectedProperty(id)` (looks the item up in `items` and resets the sub-statuses), `clearSelectedProperty`, `resetVerifyStatus`, `clearErrors`
- **Map:**
  ```
  id, ward_id→wardId, lat, lng, area_sqm→areaSqm, detection_type→detectionType, confidence,
  ndbi_delta→ndbiDelta (fallback confidence_breakdown.ndbi_delta, else 0),
  confidence_breakdown→confidenceBreakdown {ndbi_delta, area_delta, osm_status, ndvi_drop, db_match},
  detected_at→detectedAt, s3_geojson_key→s3GeojsonKey, status (default 'pending'),
  comparison_year→comparisonYear, baseline_year→baselineYear, ai_explanation→aiExplanation
  ```

**stats**
- **State:** `{ wardStats, allWardsStats, aiBreif, status, allWardsStatus, briefStatus, briefError, error }`
- **Thunks:**
  - `fetchStats({wardId})`: `GET /api/stats?ward_id=`
  - `fetchAllWardsStats()`: `GET /api/stats/all-wards` returns `{wards[], ai_brief, totals}`
  - `fetchCommissionerBrief()`: **agentApi** `GET /api/brief` returns `{ai_brief}`
- **Maps:**
  - stats: `total_detections, new_builds, change_of_use, pending_verification, verified, false_positives, revenue_estimate, ward_id` → camelCase
  - all-wards: `ward_id, ward_name, unassessed_count, total_detections, open_tickets, resolved_tickets, ai_brief, avg_ndbi_delta, max_ndbi_delta`
- **Selectors:** `selectWardStats, selectAllWardsStats, selectStatsStatus, selectAllWardsStatus, selectAiBrief, selectBriefStatus, selectBriefError, selectStatsError`

**admin**
- **State:** `{ dataMode:'demo', pipelineStatus:'idle', lastRefresh:null, ndbiThreshold:0.15, uploadStatus, uploadError, configStatus, error }`
- **Thunks:**
  - `fetchAdminConfig()`: `GET /api/stats`, reading `data_mode, pipeline_status, last_refresh, ndbi_threshold` (the splash waits on this)
  - `uploadCSV(formData)`: `POST /api/admin/upload-csv` (multipart); on success `dataMode='live'`
  - `saveDbConfig(obj)`: `POST /api/admin/db-config`
  - `triggerRefresh()`: `POST /api/admin/refresh`; the pipeline status goes `running` → `completed` or `failed`
- **Reducers:** `setDataMode, resetUploadStatus, clearErrors`

**chat**
- **State:** `{ messages:[{role:'user'|'assistant', content}], status, error }`
- **Thunk:** `sendChatMessage(text)` sends **agentApi** `POST /api/chat {message}` and reads the reply from `data.reply ?? data.response ?? data.message`.
- `pending` pushes the user message; `fulfilled` pushes the assistant message; `rejected` pushes `"Error: …"`.
- **Reducer:** `clearChat`.

**alerts**
- **State:** `{ items, status, exportStatus, generateStatus, generateError, lastGenerated, error }`
- **Thunks:**
  - `fetchAlerts(wardId)`: `GET /api/wards/{id}/alerts`, returns an array
  - `generateWardAlert(wardId)`: **agentApi** `POST /api/wards/{id}/alert`, returns `{alert:{text,severity,score}}`, then refetches
  - `exportAlerts()`: `POST /api/alerts/export` returns `{presigned_url | url}`
- **Map:** `id, severity (default 'info'), text ?? message, ward_id→wardId, created_at→createdAt`

**tickets**
- **State:** `{ items, status, error, createStatus, createError, reviewStatus, reviewError }`
- **Thunks:**
  - `fetchTickets({wardId,status})`: `GET /api/tickets` returns `{tickets[]}`
  - `createTicket(ui)`: `POST /api/tickets` with `mapUIToAPI`: `{ward_id, property_id, house_number, description, tax_pending, photo_s3_key}`
  - `getPhotoUploadUrl(filename)`: `POST /api/tickets/photo-upload {filename}` returns `{upload_url, s3_key}`
  - `reviewTicket({ticketId,status,supervisorNotes,reviewedBy='supervisor'})`: `PATCH /api/tickets/{id}/review {status, supervisor_notes, reviewed_by}`
- **Map:** `id, ward_id, ward_name, property_id, house_number, description, tax_pending, photo_s3_key, photo_url, status (default 'open'), supervisor_notes, reviewed_by, reviewed_at, created_at, updated_at`

**sources**
- **State:** `{ items, status, error, uploadStatus, uploadError }`
- **Thunks:**
  - `fetchSources({type,wardId,status})`: `GET /api/sources` returns `{sources[]}`
  - `uploadSource({fileContent(base64), type, wardId, filename, crs, capturedAt})`: `POST /api/sources/upload {file_content, type, filename, ward_id?, crs?, captured_at?}`
- **Map:** `id, type, ward_id, s3_key, filename, crs, status, captured_at, created_at, metadata, download_url`

**harmonization**
- **State:** `{ matches, matchesStatus, matchesError, runStatus, runError, lastRunResult }`
- **Thunks:**
  - `runMatching(wardId)`: `POST /api/harmonization/run?ward_id=` (empty body) returns `{sources_evaluated, matches_created, conflicts_created, …}`
  - `fetchMatches({wardId,minScore})`: `GET /api/harmonization/matches?ward_id&min_score` returns `{matches[]}`
- **Map:** `id, source_a_id, source_a_type, source_b_id, source_b_type, geometry_iou, centroid_distance_m, match_score, confidence_score, band, matched_at`

**conflicts**
- **State:** `{ items, status, error, resolveStatus, resolveError }`
- **Thunks:**
  - `fetchConflicts({wardId,status})`: `GET /api/conflicts` returns `{conflicts[]}`
  - `resolveConflict({id,status,notes,resolvedBy})`: `POST /api/conflicts/{id}/resolve {status, notes, resolved_by}`
- **Map:** `id, ward_id, match_id, conflict_type, severity, suggested_resolution, status, resolved_by, resolved_at`

**assessments** (local only, no API yet)
- **State:** `{ items:[], lastSubmittedId }`
- **Reducers:**
  - `submitAssessment(form)` is a prepared action that adds `id: 'ASMT-0001'…`, `officerId:'OFF-1042'`, `submittedAt`, `status:'pending_review'`, and unshifts the item onto the list
  - `updateAssessmentStatus({id,status})`
  - `clearLastSubmitted`
- **Selectors:** `selectAssessments, selectPendingAssessments, selectPendingAssessmentsCount, selectLastSubmittedId`
- `mapAPIToUI` and `mapUIToAPI` are pre-written for the future `POST /api/assessments` and `PATCH /api/assessments/{id}`.

---

## 11. API contract

Base paths: `api` → `VITE_API_URL`; `agent` → `VITE_AGENT_API_URL`. All bodies are JSON unless noted.

| # | Client | Method | Path | Params / Body | Response (fields used) |
|---|---|---|---|---|---|
| 1 | api | GET | `/api/wards` | — | `[{id, name, bbox{north,south,east,west}, geojson_s3, detection_count}]` |
| 2 | api | GET | `/api/wards/{id}/changes` | — | `{presigned_url}` → GeoJSON FeatureCollection (features have `id, detection_type, confidence`) |
| 3 | api | GET | `/api/wards/{id}/unassessed` | `type, status, comparison_year` | `[property]` (see properties map) |
| 4 | api | GET | `/api/wards/{id}/alerts` | — | `[{id, severity, text, ward_id, created_at}]` |
| 5 | api | GET | `/api/properties/{id}` | — | `property` |
| 6 | api | POST | `/api/properties/{id}/verify` | `{status, notes, updated_by}` | `{status}` |
| 7 | api | GET | `/api/stats` | `ward_id?` | `{total_detections, new_builds, change_of_use, pending_verification, verified, false_positives, revenue_estimate, ward_id, data_mode, pipeline_status, last_refresh, ndbi_threshold}` |
| 8 | api | GET | `/api/stats/all-wards` | — | `{wards:[{ward_id, ward_name, unassessed_count, total_detections, open_tickets, resolved_tickets, avg_ndbi_delta, max_ndbi_delta}], ai_brief, totals}` |
| 9 | api | POST | `/api/alerts/export` | — | `{presigned_url}` |
| 10 | api | POST | `/api/admin/upload-csv` | multipart `file` | `{properties_imported}` |
| 11 | api | POST | `/api/admin/db-config` | `{host, port, database, username, password}` or `{ndbi_threshold}` | `{}` |
| 12 | api | POST | `/api/admin/refresh` | — | `{triggered}` |
| 13 | api | GET | `/api/tickets` | `ward_id?, status?` | `{tickets:[ticket]}` |
| 14 | api | POST | `/api/tickets` | `{ward_id, property_id?, house_number, description, tax_pending?, photo_s3_key?}` | ticket |
| 15 | api | POST | `/api/tickets/photo-upload` | `{filename}` | `{upload_url, s3_key}` → browser `PUT`s the file to `upload_url` |
| 16 | api | PATCH | `/api/tickets/{id}/review` | `{status, supervisor_notes, reviewed_by}` | `{status}` |
| 17 | api | GET | `/api/sources` | `type?, ward_id?, status?` | `{sources:[source]}` |
| 18 | api | POST | `/api/sources/upload` | `{file_content (base64), type, filename, ward_id?, crs?, captured_at?}` | `{id, status, s3_key, message}` (201) |
| 19 | api | POST | `/api/harmonization/run` | query `ward_id?`, body `{}` | `{sources_evaluated, matches_created, conflicts_created, …}` |
| 20 | api | GET | `/api/harmonization/matches` | `ward_id?, min_score?` | `{matches:[match]}` |
| 21 | api | GET | `/api/conflicts` | `ward_id?, status?` | `{conflicts:[conflict]}` |
| 22 | api | POST | `/api/conflicts/{id}/resolve` | `{status, notes, resolved_by}` | `{id, status}` |
| 23 | api | GET | `/api/export/geojson` | `layer, ward_id?` | FeatureCollection + `{count, truncated}` |
| 24 | api | POST | `/api/export/csv` | `{layer, ward_id?}` | `{presigned_url, row_count}` |
| 25 | agent | POST | `/api/chat` | `{message}` | `{reply \| response \| message}` |
| 26 | agent | GET | `/api/explain/{propertyId}` | — | `{ai_explanation}` (markdown) |
| 27 | agent | GET | `/api/brief` | — | `{ai_brief}` (markdown) |
| 28 | agent | POST | `/api/wards/{id}/alert` | — | `{alert_id, alert:{text, severity, score}, saved}` |

### Enums
| Name | Values |
|---|---|
| Property verification status | `pending, verified, underassessed, false_positive, already_assessed` |
| Detection type | `new_build, change_of_use` |
| Ticket status | `open, under_review, resolved` |
| Assessment status | `pending_review, reviewed` |
| Source type | `cadastral, revenue, municipal_gis, utility, drone_imagery, ori, dsm_dtm, ground_truth, gnss_cors, building_footprint` |
| Source status | `ready, processing, pending_ocr, failed` |
| Match band | `auto_accept, review, conflict` |
| Conflict severity | `critical, high, medium, low` |
| Conflict type (seen) | `geometry_mismatch, attribute_mismatch` |
| Conflict status (seen) | `pending, needs_review, resolved` |
| Alert severity | `info, warning, danger` (stored) / `LOW, MEDIUM, HIGH` (generated) |
| Pipeline status | `idle, running, completed, failed` |
| Data mode | `demo, live` |
| Export layer | `parcels, conflicts, source_records` |

---

## 12. Mock mode (MSW)

- **Enable:** set `VITE_MOCK=true`, run `npx msw init public/`, and `main.jsx` starts the worker before rendering.
- `src/mocks/browser.js`: `export const worker = setupWorker(...handlers);`
- `src/mocks/handlers.js`:
  - `BASE = ''` (relative paths, so it intercepts regardless of the API URL)
  - passes through Google Maps and font requests
  - keeps mutable in-memory copies so verify and resolve actions persist during the session
  - adds realistic `delay()`s of 200–1400ms
- **Mock data:**
  - **Wards** (5, with bboxes around Vizag):
    1. Seethammadhara `{N 17.745, S 17.715, E 83.315, W 83.280}`
    2. Gopalapatnam `{N 17.778, S 17.748, E 83.278, W 83.245}`
    3. Maddilapalem
    4. Asilmetta
    5. Dwaraka Nagar
  - **Properties:** a `makeProperty(id, wardId, lat, lng, type, conf, status, areaSqm, cmpYear)` generator. It derives the 5 `confidence_breakdown` signals from `conf` with a deterministic jitter, and creates a markdown `ai_explanation` for non-pending items. About 32 properties across 5 wards.
  - **Stats:** `computeStats(wardId)` aggregates the properties. Revenue = Σ area × (80 for new builds, 40 for change of use) over pending and underassessed items. It returns `data_mode:'demo'`, `pipeline_status:'idle'`, `last_refresh:'2026-07-30T04:00:00Z'` and `ndbi_threshold:0.15`.
  - **All-wards:** 5 wards with unassessed/total counts, plus a markdown `ai_brief` ("GVMC Daily Detection Brief — 31 July 2026" with headings, bullets and a metrics table).
  - **Alerts:** 2–3 per ward (danger / warning / info) with relative timestamps.
  - **Sources:** 8 (cadastral, revenue PDF (pending_ocr), municipal_gis, drone TIFF (EPSG:32644), ground_truth, building_footprint, utility, and a revenue PDF with `metadata.ocr_extracted {khata_no, owner_name, area}` with per-field confidence).
  - **Matches:** 6, with scores 96.1 → 35.8 across all three bands.
  - **Conflicts:** 3 (high, medium, critical).
  - **Chat:** 5 canned markdown answers, picked by `message.length % 5`.
  - Explain, brief, generate-alert, upload and export mocks return the shapes listed in §11.
  - **There are no mocks for `/api/tickets*`.** Add them in a replica if you want the Supervisor tickets to work offline.
- `src/mockData/comparisonData.js`, used by ComparisonControls independently of the API:
  ```js
  export const COMPARISON_YEARS = [2022, 2024, 2026];
  // keyed "base-compare"
  '2022-2024': { newStructures: 24, changeOfUse: 9,  builtUpAreaIncreaseSqm: 6840,  estimatedAssessableAreaSqm: 4920, avgNdbiChange: 0.15, estimatedTaxImpactInr: 612000 },
  '2022-2026': { newStructures: 47, changeOfUse: 18, builtUpAreaIncreaseSqm: 12480, estimatedAssessableAreaSqm: 8960, avgNdbiChange: 0.24, estimatedTaxImpactInr: 1284000 },
  '2024-2026': { newStructures: 23, changeOfUse: 11, builtUpAreaIncreaseSqm: 5640,  estimatedAssessableAreaSqm: 4040, avgNdbiChange: 0.13, estimatedTaxImpactInr: 672000 },
  export function getComparisonStats(b, c) { return BY_RANGE[`${b}-${c}`] ?? BY_RANGE['2022-2024']; }
  ```
  It also exports `COMPARISON_PROPERTIES`: 5 sample properties with a per-year `timeline` (not rendered at present).

---

## 13. Testing

- Vitest with `globals: true` and `environment: 'jsdom'`. `src/tests/setup.js` contains `import '@testing-library/jest-dom';`.
- **Existing tests:** `components/AppSplash.test.jsx`, `components/EmptyState.test.jsx`, `components/Loader.test.jsx`, `views/IntegrationView.test.jsx`.
- **Pattern:**
  - render inside a real store with `<Provider store={configureStore({reducer:{…}})}>` (plus `<MemoryRouter>` for routed components)
  - mock `api/client.js` with `vi.mock`
  - assert on visible text and roles
- **Commands:** `npm run test`, `npm run test -- Loader` (one file), `npm run test:watch`.

---

## 14. Known quirks

Reproduce these for fidelity, or fix them in the replica:
1. `index.html` references `/favicon.svg`, but it is **not in `public/`**, so the browser gets a 404.
2. The CSS uses `--z-tooltip` (Officer toast) and `--text-tertiary` (Commissioner "—"), and **neither is defined**. Define `--z-tooltip: 700;` and `--text-tertiary: var(--text-muted);`.
3. The state key is misspelled **`aiBreif`** in `statsSlice`. The selector name `selectAiBrief` is correct.
4. The admin config is loaded from `GET /api/stats`, which doubles as the config endpoint.
5. `fetchWardGeoJSON` is commented out in WardSelector, and the map's "Show/Hide Change Polygons" toggle is commented out. The officer map therefore uses **heatmap circles** from the property lat/lng.
6. The Admin DB form defaults to port **3306** (MySQL) with the placeholder `gvmc_sw14`, although the backend plan is Postgres (5432).
7. Assessments are Redux-only (lost on refresh) and use the hard-coded officer `OFF-1042`. `OfficerAssessmentForm` is not mounted.
8. No MSW handlers exist for the tickets endpoints.
9. The `treat-js-files-as-jsx` Vite plugin is a no-op.
10. The Commissioner toolbar title is hidden on desktop (`display:none` above 1024px).
11. Hard-coded `updated_by: 'officer'`, `resolved_by: 'officer'` and `reviewed_by: 'supervisor'` stand in for a real user because there is no auth.

---

## 15. Rebuild checklist

1. **Scaffold** a Vite React project and install the dependencies (§2). Add `vite.config.js` and `index.html` (§4), plus `.env` with the 3–5 `VITE_*` variables.
2. **Design system:** create the 4 files in `src/styles/` verbatim (§6) and import them in the §5 order.
3. **API layer:** `api/client.js` (both axios instances) and `api/exportLayer.js`.
4. **Redux:** the 11 slices exactly as in §10, and `Store.jsx`.
5. **Shell:**
   - `GoogleMapsProvider`, `PageMotion`, `ScrollToTop`, `Loader`, `EmptyState`, `DemoModeBadge`
   - `AppSplash` and `Navbar` (§7)
   - `main.jsx` and `App.jsx` (§5)
6. **Shared components:**
   - `WardSelector`, `StatsBar`, `ComparisonControls` (+ `mockData/comparisonData.js`)
   - `PropertyList`, `ConfidenceCard`, `VerifyPanel`, `RaiseTicketPanel`, `ChatPanel`
   - `AlertPanel`, `TicketsList`, `TicketReviewModal`, `PendingAssessmentsPanel`
   - `MapView` (§9)
7. **Pages**, in order: Home → Officer → Supervisor → Commissioner → Integration → Admin (§8), with the exact copy and layout rules.
8. **Mocks:** `mocks/` handlers and data (§12), `npx msw init public/`, then run with `VITE_MOCK=true npm run dev` and click through every page.
9. **Responsive pass:** check at 1440, 1100, 1024, 768, 600 and 375px widths (stacked map pages, hamburger, 44px touch targets).
10. **Tests** (§13). Then `npm run build` → `dist/` → push to Amplify with the SPA rewrite and the `VITE_*` env vars (§4).
