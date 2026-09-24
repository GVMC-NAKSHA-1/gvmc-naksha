import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FiBell } from 'react-icons/fi';
import AppSplash from './AppSplash';
import EmptyState from './EmptyState';
import Loader from './Loader';

describe('AppSplash', () => {
  it('shows the brand and loading hint', () => {
    render(<AppSplash />);
    expect(screen.getByText('GVMC Detection')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Preparing satellite intelligence…');
  });
});

describe('EmptyState', () => {
  it('renders message and optional action', async () => {
    const onAction = vi.fn();
    render(<EmptyState icon={FiBell} message="Nothing here" actionLabel="Retry" onAction={onAction} />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the button without an action', () => {
    render(<EmptyState message="Empty" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Loader', () => {
  it('is an accessible status with a label', () => {
    render(<Loader size="lg" label="Loading wards" />);
    expect(screen.getByRole('status', { name: 'Loading wards' })).toBeInTheDocument();
  });
});
