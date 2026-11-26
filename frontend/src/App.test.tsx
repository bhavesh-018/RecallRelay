import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App baseline shell', () => {
  it('renders the RecallRelay operator header and console title', () => {
    render(<App />);
    expect(screen.getByText('RecallRelay')).toBeInTheDocument();
    expect(screen.getByText('RecallRelay Operator Console')).toBeInTheDocument();
  });
});
