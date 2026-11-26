import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { RecallFlow } from './RecallFlow';

describe('RecallFlow reusable component (standard mode)', () => {
  const baseProps = {
    batchCode: 'B17',
    productName: 'SunGrain Crunchy Oats 500g',
    locationName: 'Shop A (Downtown)',
    noticeText: 'Count Batch B17 stock and confirm quarantine.',
    received: 15,
    forwarded: 0,
  };

  it('always displays Fictional recall drill banner and submits valid whole integers', () => {
    const onSubmit = vi.fn();
    render(<RecallFlow {...baseProps} onSubmit={onSubmit} />);

    expect(screen.getByText('Fictional recall drill')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Units Sold'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Units Remaining at Location'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Units Set Aside/i), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Recall Response' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      forwarded_qty: 0,
      sold_qty: 5,
      remaining_qty: 10,
      set_aside_qty: 10,
      confirmed_set_aside: true,
    });
  });

  it('blocks negative or fractional inputs and displays deterministic backend errors', () => {
    const onSubmit = vi.fn();
    render(
      <RecallFlow
        {...baseProps}
        errorMessage="Stock balance mismatch: received (15) must equal 14."
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Stock balance mismatch');

    fireEvent.change(screen.getByLabelText('Units Sold'), { target: { value: '-1' } });
    fireEvent.change(screen.getByLabelText('Units Remaining at Location'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Units Set Aside/i), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Recall Response' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('whole non-negative integers');
  });
});
