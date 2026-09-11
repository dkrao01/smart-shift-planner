import { Modal } from './common/Modal';
import { Button } from './common/Button';
import { formatShortDate } from '../utils/dateUtils';
import type { AvailabilityPlan } from '../services/availabilityPlanning';

export function AvailabilityPlanReview({ plan, busy, onClose, onApply }: {
  plan: AvailabilityPlan; busy: boolean; onClose: () => void; onApply: () => void;
}) {
  const employee = plan.snapshot.employees.find(e => e.id === plan.employeeId);
  return <Modal isOpen title="Review schedule correction" size="lg" onClose={() => { if (!busy) onClose(); }} footer={<>
    <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
    <Button loading={busy} disabled={!plan.employeeId && !plan.changes.length} onClick={onApply}>
      {plan.employeeId ? 'Apply changes and approve' : 'Apply correction'}
    </Button>
  </>}>
    <div className="space-y-4 text-sm text-navy-200">
      <p>A valid arrangement exists for every employee, with 6 Day, 6 Evening and 6 Night shifts, assigned rest days, shift capacity and no Night followed by Day.</p>
      {employee && <p>This will approve {employee.name}.</p>}
      {plan.changes.length ? <>
        <p>{plan.changes.length} shift choices will change. {plan.changes.some(c => c.approved) && 'This includes previously approved shifts.'}</p>
        <div className="overflow-x-auto"><table className="w-full text-xs text-left">
          <thead className="text-navy-400"><tr><th className="py-2">Employee</th><th>Date</th><th>Current</th><th>Proposed</th></tr></thead>
          <tbody>{plan.changes.map(c => <tr key={`${c.employeeId}|${c.date}`} className="border-t border-navy-700">
            <td className="py-2">{c.name}{c.approved && <span className="block text-amber-300">Already approved</span>}</td>
            <td>{formatShortDate(c.date)}</td><td className="capitalize">{c.before}</td><td className="capitalize text-brand-300">{c.after}</td>
          </tr>)}</tbody>
        </table></div>
      </> : <p>No changes to existing approved shifts are needed.</p>}
      <p className="text-xs text-navy-400">Other employees keep their drafts and still need to complete and submit their choices. The arrangement below shows one way they can finish.</p>
      <details><summary className="cursor-pointer text-brand-300">View the complete valid arrangement</summary>
        <div className="mt-3 space-y-3">{plan.snapshot.employees.map(e => <details key={e.id}>
          <summary className="cursor-pointer">{e.name}</summary>
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs">{plan.choices.filter(c => c.employeeId === e.id).map(c => <div key={c.date}>{formatShortDate(c.date)}: <span className="capitalize">{c.status}</span></div>)}</div>
        </details>)}</div>
      </details>
    </div>
  </Modal>;
}
