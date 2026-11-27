import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from './App';

describe('App operator console shell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders RecallRelay navigation and empty-recall prompt cleanly', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/operator/me')) {
        return new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 });
      }
      if (url.includes('/api/recalls')) {
        return new Response(JSON.stringify({ recalls: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<App />);
    expect(screen.getByText('RecallRelay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Batch Trace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish Recall' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('No Active Recall Published')).toBeInTheDocument();
    });

    const toggleBtn = screen.getByRole('button', { name: /Switch to light mode/i });
    fireEvent.click(toggleBtn);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: /Switch to dark mode/i })).toBeInTheDocument();
  });
});
