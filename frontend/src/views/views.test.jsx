import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { handlers } from '../mocks/handlers';
import { makeStore } from '../Redux/Store.jsx';
import { fetchWards, setSelectedWard } from '../Redux/slices/wardsSlice';
import AppShell from '../components/AppShell';
import OverviewPage from './OverviewPage';
import SourcesPage from './SourcesPage';
import MatchingPage from './MatchingPage';
import AttributeMappingPage from './AttributeMappingPage';
import ConflictsPage from './ConflictsPage';
import RecordsPage from './RecordsPage';
import ChangeDetectionPage from './ChangeDetectionPage';
import SettingsPage from './SettingsPage';
import GeorefPage from './GeorefPage';
import ExtractionPage from './ExtractionPage';
import TopologyPage from './TopologyPage';
import ValidationPage from './ValidationPage';
import ExchangePage from './ExchangePage';
import ActivityPage from './ActivityPage';

// The mock handlers match `*/api/...`, so they serve the relative requests made in tests.
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const T = { timeout: 5000 };

async function renderPage(ui, { ward = '1', path = '/' } = {}) {
  const store = makeStore();
  if (ward) {
    await store.dispatch(fetchWards());
    store.dispatch(setSelectedWard(ward));
  }
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}><AppShell>{ui}</AppShell></MemoryRouter>
    </Provider>,
  );
  return { store, ...utils };
}

describe('AppShell', () => {
  it('shows the pipeline navigation and the shared ward picker', async () => {
    await renderPage(<div />);
    for (const label of ['Data sources', 'Geo-referencing', 'AI feature extraction', 'Topology QA', 'Integration map', 'Spatial matching', 'Attribute mapping', 'Conflicts', 'Validation & sync', 'Change detection', 'Golden records', 'Data exchange']) {
      expect(screen.getAllByRole('link', { name: new RegExp(label) }).length).toBeGreaterThan(0);
    }
    expect(screen.getByLabelText('Ward')).toHaveValue('1');
  });
});

describe('OverviewPage', () => {
  it('shows PS outcomes, every pipeline stage and all ten source types', async () => {
    await renderPage(<OverviewPage />);
    expect(await screen.findByText('Source coverage — 10 NAKSHA data types')).toBeInTheDocument();
    for (const t of ['Drone imagery', 'Orthorectified (ORI)', 'DSM / DTM', 'Cadastral maps', 'Revenue records', 'Municipal GIS', 'Utility networks', 'Ground truthing (GT)', 'GNSS / CORS survey', 'Building footprints']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    for (const t of ['Manual GIS effort avoided', 'Record accuracy', 'Consistency', 'Ready for finalisation']) expect(screen.getByText(t)).toBeInTheDocument();
    for (const t of ['Geo-referencing', 'AI extraction', 'Topology QA', 'Validation & sync', 'Data exchange']) {
      expect(screen.getByRole('button', { name: new RegExp(t) })).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByRole('button', { name: /Golden records/ })).toHaveTextContent('12'), T);
  }, 15000);
});

describe('SourcesPage', () => {
  it('lists ward sources and opens the detail with OCR fields', async () => {
    await renderPage(<SourcesPage />);
    const row = await screen.findByText('khata_scan_0042.pdf', {}, T);
    await userEvent.click(row);
    const detail = await screen.findByRole('complementary', { name: 'Source detail' });
    expect(await within(detail).findByText('OCR-extracted fields', {}, T)).toBeInTheDocument();
    expect(within(detail).getByText('1142/B')).toBeInTheDocument();
  }, 15000);
});

describe('MatchingPage', () => {
  it('shows scored matches and the confidence breakdown for a selected pair', async () => {
    await renderPage(<MatchingPage />);
    const rows = await screen.findAllByRole('row', {}, T);
    await userEvent.click(rows.find((r) => r.getAttribute('aria-selected') != null));
    expect(await screen.findByText('Confidence scoring', {}, T)).toBeInTheDocument();
    expect(screen.getByText(/Geometric match × 0.4/)).toBeInTheDocument();
  }, 15000);
});

describe('AttributeMappingPage', () => {
  it('suggests field mappings between cadastral and revenue schemas', async () => {
    await renderPage(<AttributeMappingPage />);
    const [a, b] = await screen.findAllByRole('combobox', {}, T).then((cs) => cs.filter((c) => c.getAttribute('aria-label') !== 'Ward'));
    await waitFor(() => expect(within(a).getAllByRole('option').length).toBeGreaterThan(2), T);
    await userEvent.selectOptions(a, 'src-1-cadastral');
    await userEvent.selectOptions(b, 'src-1-revenue');
    await userEvent.click(screen.getByRole('button', { name: /Suggest with AI/ }));
    expect(await screen.findByText(/Suggested mappings/, {}, T)).toBeInTheDocument();
    expect(screen.getAllByText('khata_number').length).toBeGreaterThan(0);
  }, 15000);
});

describe('ConflictsPage', () => {
  it('resolves a conflict', async () => {
    const { store } = await renderPage(<ConflictsPage />);
    await waitFor(() => expect(store.getState().conflicts.status).toBe('succeeded'), T);
    const cards = await screen.findAllByRole('button', { pressed: false, name: /mismatch|both/i }, T);
    await userEvent.click(cards[0]);
    await userEvent.click(await screen.findByRole('button', { name: /^Resolve$/ }, T));
    expect(await screen.findByText(/Saved\. Re-assemble/, {}, T)).toBeInTheDocument();
  }, 15000);
});

describe('RecordsPage', () => {
  it('lists golden records with provenance', async () => {
    await renderPage(<RecordsPage />);
    const rows = await screen.findAllByRole('row', {}, T);
    await userEvent.click(rows.find((r) => r.getAttribute('aria-selected') != null));
    expect(await screen.findByText('Attributes & provenance', {}, T)).toBeInTheDocument();
  }, 15000);
});

describe('ChangeDetectionPage', () => {
  it('shows the seeded epoch comparison and confirms a change', async () => {
    await renderPage(<ChangeDetectionPage />);
    expect(await screen.findByText(/2023 → /, {}, T)).toBeInTheDocument();
    const rows = await screen.findAllByRole('row', {}, T);
    expect(rows.length).toBeGreaterThan(3);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Confirm change' }))[0]);
    expect(await screen.findByText('confirmed', {}, T)).toBeInTheDocument();
  }, 15000);

  it('still shows NDBI satellite alerts with verification', async () => {
    const { store } = await renderPage(<ChangeDetectionPage />);
    await userEvent.click(screen.getByRole('tab', { name: 'Satellite NDBI alerts' }));
    const rows = await screen.findAllByRole('row', {}, T);
    await userEvent.click(rows.find((r) => r.getAttribute('aria-selected') != null));
    expect(await screen.findByText('Verification', {}, T)).toBeInTheDocument();
    const target = store.getState().properties.selectedItem.status === 'verified' ? 'Underassessed' : 'Verified';
    await userEvent.click(screen.getByRole('button', { name: target }));
    expect(await screen.findByText('Status updated successfully.', {}, T)).toBeInTheDocument();
  }, 15000);
});

describe('GeorefPage', () => {
  it('lists the scan awaiting control points and converts coordinates', async () => {
    await renderPage(<GeorefPage />);
    expect(await screen.findByText('village_map_seethammadhara_1986.png', {}, T)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Scanned map sheet' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Transform 2 points/ }));
    const out = await screen.findByLabelText('Transformed coordinates', {}, T);
    expect(out.textContent).toMatch(/^7\d{5}\.\d{3}, 19\d{5}\.\d{3}/);   // UTM 44N easting / northing
  }, 15000);
});

describe('ExtractionPage', () => {
  it('shows the extraction run and its metrics, and starts a new run', async () => {
    await renderPage(<ExtractionPage />);
    expect(await screen.findByText('Extraction runs', {}, T)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('nDSM (height)').length).toBeGreaterThan(0), T);
    const run = await screen.findByRole('button', { name: /Extract footprints/ }, T);
    await waitFor(() => expect(run).toBeEnabled(), T);
    await userEvent.click(run);
    expect(await screen.findByText(/Extraction queued/, {}, T)).toBeInTheDocument();
  }, 15000);
});

describe('TopologyPage', () => {
  it('lists open topology issues and accepts a fix', async () => {
    const { store } = await renderPage(<TopologyPage />);
    await waitFor(() => expect(store.getState().processing.issues.length).toBeGreaterThan(0), T);
    const accept = await screen.findAllByRole('button', { name: 'Accept fix' }, T);
    if (accept.length !== 4) throw new Error('DBG ' + accept.length + ' ' + store.getState().processing.issues.map((i) => i.id + ':' + i.status).join(','));
    const before = accept.length;
    await userEvent.click(accept[0]);
    await waitFor(() => expect(screen.queryAllByRole('button', { name: 'Accept fix' })).toHaveLength(before - 1), T);
  }, 15000);
});

describe('ValidationPage', () => {
  it('shows the ward score, source scorecards and sync findings', async () => {
    await renderPage(<ValidationPage />);
    expect(await screen.findByText('Ward data-quality score', {}, T)).toBeInTheDocument();
    expect(await screen.findByText('Structures registered in cadastre', {}, T)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Unregistered structure/ })).toHaveTextContent('1'), T);
    expect(screen.getByRole('button', { name: /Encroachment/ })).toHaveTextContent('1');
  }, 15000);
});

describe('ExchangePage', () => {
  it('lists OGC API collections', async () => {
    await renderPage(<ExchangePage />);
    expect(await screen.findByText('Harmonized parcels (golden records)', {}, T)).toBeInTheDocument();
    expect(screen.getByText('sync-findings')).toBeInTheDocument();
  }, 15000);
});

describe('ActivityPage', () => {
  it('shows pipeline jobs and the audit trail', async () => {
    await renderPage(<ActivityPage />);
    expect((await screen.findAllByText('AI feature extraction', {}, T)).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Audit trail' }));
    expect((await screen.findAllByText('extraction.run', {}, T)).length).toBeGreaterThan(0);
  }, 15000);
});

describe('SettingsPage', () => {
  it('reports service health and saves thresholds', async () => {
    await renderPage(<SettingsPage />);
    expect(await screen.findByText('Spatial database')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('ok').length).toBe(3), T);
    await userEvent.click(screen.getByRole('button', { name: 'Save thresholds' }));
    expect(await screen.findByText('Saved.', {}, T)).toBeInTheDocument();
  }, 15000);
});
