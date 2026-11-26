import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { RecallFlow } from './RecallFlow';

describe('RecallFlow reusable component (standard and guided variants)', () => {
  const baseProps = {
    batchCode: 'B17',
    productName: 'SunGrain Crunchy Oats 500g',
    locationName: 'Shop A (Downtown)',
    noticeText: 'Count Batch B17 stock and confirm quarantine.',
    received: 15,
    forwarded: 0,
  };

  it('always displays Fictional recall drill banner and submits valid whole integers in standard mode', () => {
    const onSubmit = vi.fn();
    render(<RecallFlow {...baseProps} workflow="standard" onSubmit={onSubmit} />);

    expect(screen.getByText('Fictional recall drill')).toBeInTheDocument();
    expect(screen.getByText(baseProps.noticeText)).toBeInTheDocument();

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

  it('blocks negative inputs and displays deterministic backend errors in standard mode', () => {
    const onSubmit = vi.fn();
    render(
      <RecallFlow
        {...baseProps}
        workflow="standard"
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

  it('walks through guided Count -> Reconcile -> Confirm and submits identical payload', () => {
    const onSubmit = vi.fn();
    render(<RecallFlow {...baseProps} workflow="guided" onSubmit={onSubmit} />);

    expect(screen.getByText('Fictional recall drill')).toBeInTheDocument();
    expect(screen.getByText(baseProps.noticeText)).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3 · Count')).toBeInTheDocument();

    // Step 1 -> Step 2 with mismatched math first
    fireEvent.change(screen.getByLabelText('Units Sold'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Units Remaining at Location'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue to Reconcile/i }));

    expect(screen.getByText('Step 2 of 3 · Reconcile')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Stock balance mismatch');
    expect(screen.getByRole('button', { name: /Continue to Confirm/i })).toBeDisabled();

    // Go back, fix count to 10, reconcile passes -> Step 3
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    fireEvent.change(screen.getByLabelText('Units Remaining at Location'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue to Reconcile/i }));

    expect(screen.getByText(/Stock balance reconciles/i)).toBeInTheDocument();
    const confirmStepBtn = screen.getByRole('button', { name: /Continue to Confirm/i });
    expect(confirmStepBtn).toBeEnabled();
    fireEvent.click(confirmStepBtn);

    expect(screen.getByText('Step 3 of 3 · Confirm')).toBeInTheDocument();

    // Set aside > remaining blocked inside Step 3
    fireEvent.change(screen.getByLabelText(/Units Set Aside/i), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Recall Response' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('cannot exceed remaining stock');

    // Valid set aside submits exact payload
    fireEvent.change(screen.getByLabelText(/Units Set Aside/i), { target: { value: '10' } });
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

  it('reuses cleanly with second_drill MED-404 dataset without hardcoded B17 assumptions', () => {
    const onSubmit = vi.fn();
    render(
      <RecallFlow
        batchCode="MED-404"
        productName="VitaCold Electrolyte Pack 250ml"
        locationName="Harbor Clinic 1"
        noticeText="Fictional cold-chain drill for MED-404."
        received={35}
        forwarded={0}
        workflow="guided"
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText('Harbor Clinic 1')).toBeInTheDocument();
    expect(screen.getByText('MED-404')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Units Sold'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Units Remaining at Location'), { target: { value: '23' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue to Reconcile/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continue to Confirm/i }));
    fireEvent.change(screen.getByLabelText(/Units Set Aside/i), { target: { value: '23' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Recall Response' }));

    expect(onSubmit).toHaveBeenCalledWith({
      forwarded_qty: 0,
      sold_qty: 12,
      remaining_qty: 23,
      set_aside_qty: 23,
      confirmed_set_aside: true,
    });
  });
});
