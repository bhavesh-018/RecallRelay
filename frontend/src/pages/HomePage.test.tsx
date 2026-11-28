import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../App';

describe('Homepage routing', () => {
  afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

  it('shows the landing page without fetching operator data, then opens the console', async () => {
    window.history.replaceState({}, '', '/');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/api/operator/me')) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ recalls: [] }), { status: 200 });
    });
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Every batch traced.');
    expect(screen.getByRole('img')).toHaveAttribute('src', '/recall-network.svg');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByRole('link', { name: 'Join a drill' })[0]).toHaveAttribute('href', '/join');
    fireEvent.click(screen.getAllByRole('link', { name: 'Get started' })[0]);
    expect(window.location.pathname).toBe('/console');
    await waitFor(() => expect(screen.getByText('No Active Recall Published')).toBeInTheDocument());
  });
});
