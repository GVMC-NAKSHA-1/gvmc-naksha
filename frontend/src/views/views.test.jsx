import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { handlers } from '../mocks/handlers';
import { makeStore } from '../Redux/Store.jsx';
import HomePage from './HomePage';
import FieldOfficerView from './FieldOfficerView';
import SupervisorView from './SupervisorView';
import CommissionerView from './CommissionerView';
import IntegrationView from './IntegrationView';
import AdminPanel from './AdminPanel';

// The mock handlers match `*/api/...`, so they serve the relative requests made in tests.
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderView(ui, path = '/') {
  const store = makeStore();
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </Provider>,
  );
  return { store, ...utils };
}

const selectWard = async (id = '1') => {
  const select = await screen.findByLabelText('Ward');
  await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1), { timeout: 5000 });
  await userEvent.selectOptions(select, id);
};

describe('HomePage', () => {
  it('lists all five workspaces', () => {
    renderView(<HomePage />);
    for (const t of ['Field Officer', 'Supervisor', 'Commissioner', 'Integration', 'Admin Panel']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });
});

describe('FieldOfficerView', () => {
  it('loads a ward, selects a property and verifies it', async () => {
    const { store } = renderView(<FieldOfficerView />, '/officer');
    await selectWard('1');

    const rows = await screen.findAllByRole('row', { selected: false }, { timeout: 4000 });
    const dataRow = rows.find((r) => r.getAttribute('aria-selected') === 'false');
    await userEvent.click(dataRow);

    expect(await screen.findByText('Confidence')).toBeInTheDocument();
    await screen.findByText('AI Analysis', {}, { timeout: 4000 });

    const id = store.getState().properties.selectedItem.id;
    const target = store.getState().properties.selectedItem.status === 'verified' ? 'Underassessed' : 'Verified';
    await userEvent.click(screen.getByRole('button', { name: target }));
    expect(await screen.findByText('Status updated successfully.', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(store.getState().properties.items.find((p) => p.id === id).status).toBe(target.toLowerCase());
  }, 20000);
});

describe('SupervisorView', () => {
  it('shows tickets and ward alerts', async () => {
    renderView(<SupervisorView />, '/supervisor');
    expect(await screen.findByText('12-4-56/A', {}, { timeout: 4000 })).toBeInTheDocument();
    await selectWard('1');
    expect(await screen.findByText(/new structures detected in Seethammadhara/, {}, { timeout: 4000 })).toBeInTheDocument();
  }, 15000);
});

describe('CommissionerView', () => {
  it('ranks wards and renders the AI brief', async () => {
    renderView(<CommissionerView />, '/commissioner');
    expect(await screen.findByText('Top 10 Wards by Unassessed')).toBeInTheDocument();
    expect(await screen.findByText('Seethammadhara', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText(/GVMC Daily Detection Brief/, {}, { timeout: 4000 })).toBeInTheDocument();
  }, 15000);
});

describe('IntegrationView', () => {
  it('shows sources, matches and resolves a conflict', async () => {
    renderView(<IntegrationView />, '/integration');
    expect(await screen.findByText('seethammadhara_cadastral.geojson', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText('96.1', {}, { timeout: 4000 })).toBeInTheDocument();

    const resolveButtons = await screen.findAllByRole('button', { name: /Mark resolved/ });
    const before = resolveButtons.length;
    await userEvent.click(resolveButtons[0]);
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /Mark resolved/ })).toHaveLength(before - 1), { timeout: 4000 });
  }, 15000);
});

describe('AdminPanel', () => {
  it('saves the NDBI threshold', async () => {
    renderView(<AdminPanel />, '/admin');
    expect(screen.getByText('Detection Sensitivity')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save Threshold' }));
    expect(await screen.findByText('Saved.', {}, { timeout: 4000 })).toBeInTheDocument();
  }, 15000);
});
