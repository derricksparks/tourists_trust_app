import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DecisionPanel, DecisionOption } from './DecisionPanel';

const options: DecisionOption<'approve' | 'reject'>[] = [
  { value: 'approve', label: 'Approve', needsReason: false, primary: true },
  { value: 'reject', label: 'Reject', needsReason: true, confirm: 'Rejecting is final.' },
];

describe('DecisionPanel', () => {
  it('approves straight away without a reason', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(<DecisionPanel id="x" options={options} reasonPlaceholder="" onDecide={onDecide} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('approve', undefined);
  });

  it('asks for a reason, then for confirmation, before rejecting', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(<DecisionPanel id="x" options={options} reasonPlaceholder="" onDecide={onDecide} />);

    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add a reason before you reject');
    expect(onDecide).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Reason'), 'Fake licence');
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Rejecting is final.');
    expect(onDecide).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Yes, reject' }));
    expect(onDecide).toHaveBeenCalledWith('reject', 'Fake licence');
  });

  it('shows the server’s message when the decision fails', async () => {
    const { ApiError } = await import('../api');
    const onDecide = vi.fn().mockRejectedValue(new ApiError(409, 'Cannot approve an operator whose status is APPROVED'));
    render(<DecisionPanel id="x" options={options} reasonPlaceholder="" onDecide={onDecide} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot approve an operator whose status is APPROVED');
  });
});
