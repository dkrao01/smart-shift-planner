import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardHeader } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { LoadingSpinner, EmptyState, PageHeader, WarningBanner } from '../components/common/LoadingSpinner';
import { Button } from '../components/common/Button';
import { Modal, FormField, Select, Textarea } from '../components/common/Modal';
import {
  getEmployees, getAssignments, getSwapRequests,
  getActiveSchedule, createSwapRequest, resolveSwapRequest
} from '../services/dataService';
import { getEligibleSwapOptions, validateSwapEligibility } from '../utils/scheduleUtils';
import { formatDate } from '../utils/dateUtils';
import type { Employee, ShiftAssignment, SwapRequest, ShiftType, SchedulePeriod } from '../types';

const SHIFT_ICONS: Record<ShiftType, string> = { day: '☀', evening: '🌆', night: '🌙' };

export default function SwapsPage() {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([]);
  const [schedule, setSchedule] = useState<SchedulePeriod | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [approveModal, setApproveModal] = useState<SwapRequest | null>(null);
  const [managerNote, setManagerNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Create form state
  const [reqShiftId, setReqShiftId] = useState('');
  const [tgtEmpId, setTgtEmpId] = useState('');
  const [tgtShiftId, setTgtShiftId] = useState('');
  const [reason, setReason] = useState('');
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);

  const isManager = currentUser?.role === 'manager';
  const myEmpId = currentUser?.employeeId ?? '';

  async function load() {
    const [emps, asgn, swaps, sched] = await Promise.all([
      getEmployees(), getAssignments(), getSwapRequests(), getActiveSchedule()
    ]);
    setEmployees(emps); setAssignments(asgn); setSwapRequests(swaps); setSchedule(sched);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Validate swap when both shifts selected
  useEffect(() => {
    if (reqShiftId && tgtShiftId && assignments.length > 0) {
      const warnings = validateSwapEligibility(assignments, employees, reqShiftId, tgtShiftId, schedule?.startDate ?? '');
      setValidationWarnings(warnings.map(w => w.message));
    } else {
      setValidationWarnings([]);
    }
  }, [reqShiftId, tgtShiftId, assignments, employees, schedule]);

  const myShifts = assignments.filter(a => a.employeeId === myEmpId);
  const eligibleOptions = reqShiftId
    ? getEligibleSwapOptions(assignments, employees, reqShiftId, schedule?.startDate ?? '')
    : [];
  const eligibleEmployeeIds = new Set(eligibleOptions.map(option => option.employee.id));
  const targetShifts = eligibleOptions
    .filter(option => option.employee.id === tgtEmpId)
    .map(option => option.shift);

  function getEmpName(id: string) {
    return employees.find(e => e.id === id)?.name ?? id;
  }

  function getShiftLabel(a: ShiftAssignment) {
    return `${SHIFT_ICONS[a.shiftType]} ${formatDate(a.date)} — ${a.shiftType} (${a.hours}h)`;
  }

  async function handleCreate() {
    if (!reqShiftId || !tgtShiftId || !reason || !currentUser) return;
    setSaving(true);
    await createSwapRequest({
      requesterId: myEmpId,
      targetId: tgtEmpId,
      requesterShiftId: reqShiftId,
      targetShiftId: tgtShiftId,
      reason,
      status: 'pending',
      validationWarnings,
      createdAt: new Date().toISOString(),
    });
    await load();
    setSaving(false);
    setShowCreateModal(false);
    resetForm();
  }

  function resetForm() {
    setReqShiftId(''); setTgtEmpId(''); setTgtShiftId(''); setReason(''); setValidationWarnings([]);
  }

  async function handleResolve(id: string, approved: boolean) {
    setSaving(true);
    await resolveSwapRequest(id, approved ? 'approved' : 'rejected', managerNote, currentUser!.uid);
    await load();
    setSaving(false);
    setApproveModal(null);
    setManagerNote('');
  }

  if (loading) return <LoadingSpinner label="Loading swap requests…" />;

  const pending = swapRequests.filter(s => s.status === 'pending');
  const resolved = swapRequests.filter(s => s.status !== 'pending');
  const myRequests = isManager ? swapRequests : swapRequests.filter(
    s => s.requesterId === myEmpId || s.targetId === myEmpId
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Shift Swap Requests"
        subtitle={`${pending.length} pending`}
        action={
          !isManager && (
            <Button size="sm" onClick={() => setShowCreateModal(true)} icon="⇄">
              Request Swap
            </Button>
          )
        }
      />

      {/* Pending (manager sees all, employee sees own) */}
      {pending.length > 0 && (
        <div>
          <h3 className="text-xs font-mono text-navy-500 uppercase tracking-wide mb-2">Pending Approval</h3>
          <div className="space-y-3">
            {(isManager ? pending : pending.filter(s => s.requesterId === myEmpId || s.targetId === myEmpId))
              .map(swap => (
                <SwapCard
                  key={swap.id}
                  swap={swap}
                  employees={employees}
                  assignments={assignments}
                  isManager={isManager}
                  onApprove={() => { setApproveModal(swap); setManagerNote(''); }}
                />
              ))}
          </div>
        </div>
      )}

      {/* Resolved */}
      {resolved.length > 0 && (
        <div>
          <h3 className="text-xs font-mono text-navy-500 uppercase tracking-wide mb-2">History</h3>
          <div className="space-y-2">
            {(isManager ? resolved : resolved.filter(s => s.requesterId === myEmpId || s.targetId === myEmpId))
              .map(swap => (
                <SwapCard
                  key={swap.id}
                  swap={swap}
                  employees={employees}
                  assignments={assignments}
                  isManager={isManager}
                />
              ))}
          </div>
        </div>
      )}

      {myRequests.length === 0 && (
        <EmptyState icon="⇄" title="No swap requests" description={isManager ? 'No swap requests have been submitted.' : 'Request a swap to exchange shifts with a colleague.'} />
      )}

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); resetForm(); }}
        title="Request Shift Swap"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => { setShowCreateModal(false); resetForm(); }}>Cancel</Button>
            <Button
              variant="primary" size="sm" loading={saving}
              disabled={!reqShiftId || !tgtShiftId || !reason || validationWarnings.some(w => w.includes('violation') || w.includes('understaffed'))}
              onClick={handleCreate}
            >
              Submit Request
            </Button>
          </>
        }
      >
        <FormField label="My Shift to Swap">
          <Select value={reqShiftId} onChange={e => setReqShiftId(e.target.value)}>
            <option value="">Select your shift…</option>
            {myShifts.map(a => (
              <option key={a.id} value={a.id}>{getShiftLabel(a)}</option>
            ))}
          </Select>
        </FormField>

        <FormField label="Swap With Employee">
          <p className="text-[11px] text-navy-500 mb-1.5">Only employees scheduled on {reqShiftId ? formatDate(assignments.find(a => a.id === reqShiftId)?.date ?? '') : 'the same date'} on an allowed shift type can be selected.</p>
          <Select value={tgtEmpId} onChange={e => { setTgtEmpId(e.target.value); setTgtShiftId(''); }}>
            <option value="">Select employee…</option>
            {employees.filter(e => e.id !== myEmpId && eligibleEmployeeIds.has(e.id)).map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name}</option>
            ))}
          </Select>
        </FormField>

        {reqShiftId && eligibleOptions.length === 0 && (
          <p className="text-xs text-amber-300 bg-amber-900/20 border border-amber-500/20 rounded px-3 py-2">
            No employee has a conflict-free shift available to exchange for this shift.
          </p>
        )}

        {tgtEmpId && (
          <FormField label="Their Shift">
            <Select value={tgtShiftId} onChange={e => setTgtShiftId(e.target.value)}>
              <option value="">Select their shift…</option>
              {targetShifts.map(a => (
                <option key={a.id} value={a.id}>{getShiftLabel(a)}</option>
              ))}
            </Select>
          </FormField>
        )}

        <FormField label="Reason">
          <Textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Explain why you need this swap…"
            rows={3}
          />
        </FormField>

        {validationWarnings.length > 0 && (
          <div className="space-y-1.5">
            {validationWarnings.map((w, i) => (
              <WarningBanner key={i} message={w} type="error" />
            ))}
          </div>
        )}
      </Modal>

      {/* Approve/Reject Modal */}
      {isManager && approveModal && (
        <Modal
          isOpen={!!approveModal}
          onClose={() => setApproveModal(null)}
          title="Review Swap Request"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setApproveModal(null)}>Cancel</Button>
              <Button variant="danger" size="sm" loading={saving} onClick={() => handleResolve(approveModal.id, false)}>
                Reject
              </Button>
              <Button variant="success" size="sm" loading={saving} onClick={() => handleResolve(approveModal.id, true)}>
                Approve
              </Button>
            </>
          }
        >
          <div className="space-y-3 mb-4">
            <div className="bg-navy-900 rounded-lg p-3 text-sm space-y-1.5">
              <div className="flex gap-2"><span className="text-navy-500 w-24">Requester:</span><span className="text-navy-200">{getEmpName(approveModal.requesterId)}</span></div>
              <div className="flex gap-2"><span className="text-navy-500 w-24">Target:</span><span className="text-navy-200">{getEmpName(approveModal.targetId)}</span></div>
              <div className="flex gap-2"><span className="text-navy-500 w-24">Their shift:</span><span className="text-navy-200">{getShiftLabel(assignments.find(a => a.id === approveModal.requesterShiftId)!)}</span></div>
              <div className="flex gap-2"><span className="text-navy-500 w-24">For shift:</span><span className="text-navy-200">{getShiftLabel(assignments.find(a => a.id === approveModal.targetShiftId)!)}</span></div>
              <div className="flex gap-2"><span className="text-navy-500 w-24">Reason:</span><span className="text-navy-200">{approveModal.reason}</span></div>
            </div>

            {approveModal.validationWarnings.length > 0 && (
              <div className="space-y-1">
                {approveModal.validationWarnings.map((w, i) => (
                  <WarningBanner key={i} message={w} type="warning" />
                ))}
              </div>
            )}
          </div>

          <FormField label="Manager Note (optional)">
            <Textarea
              value={managerNote}
              onChange={e => setManagerNote(e.target.value)}
              placeholder="Add a note for the employees…"
              rows={2}
            />
          </FormField>
        </Modal>
      )}
    </div>
  );
}

// ─── Swap Card ────────────────────────────────────────────────────────────────

function SwapCard({
  swap, employees, assignments, isManager, onApprove
}: {
  swap: SwapRequest;
  employees: Employee[];
  assignments: ShiftAssignment[];
  isManager: boolean;
  onApprove?: () => void;
}) {
  function getEmpName(id: string) { return employees.find(e => e.id === id)?.name ?? id; }
  function getShift(id: string) { return assignments.find(a => a.id === id); }

  const reqShift = getShift(swap.requesterShiftId);
  const tgtShift = getShift(swap.targetShiftId);

  return (
    <Card bordered>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-navy-100">{getEmpName(swap.requesterId)}</span>
          <span className="text-navy-500">⇄</span>
          <span className="text-sm font-semibold text-navy-100">{getEmpName(swap.targetId)}</span>
        </div>
        <Badge variant={swap.status}>{swap.status.charAt(0).toUpperCase() + swap.status.slice(1)}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-navy-900 rounded p-2 text-xs">
          <div className="text-navy-500 mb-1">{getEmpName(swap.requesterId)}'s shift</div>
          {reqShift && <div className="text-navy-300">{SHIFT_ICONS[reqShift.shiftType]} {formatDate(reqShift.date)} · {reqShift.shiftType} ({reqShift.hours}h)</div>}
        </div>
        <div className="bg-navy-900 rounded p-2 text-xs">
          <div className="text-navy-500 mb-1">{getEmpName(swap.targetId)}'s shift</div>
          {tgtShift && <div className="text-navy-300">{SHIFT_ICONS[tgtShift.shiftType]} {formatDate(tgtShift.date)} · {tgtShift.shiftType} ({tgtShift.hours}h)</div>}
        </div>
      </div>

      <div className="text-xs text-navy-400 mb-2 italic">"{swap.reason}"</div>

      {swap.validationWarnings.length > 0 && (
        <div className="space-y-1 mb-2">
          {swap.validationWarnings.map((w, i) => <WarningBanner key={i} message={w} type="warning" />)}
        </div>
      )}

      {swap.managerNote && (
        <div className="text-xs text-navy-400 bg-navy-900 rounded px-2 py-1.5 mb-2">
          Manager: {swap.managerNote}
        </div>
      )}

      {isManager && swap.status === 'pending' && onApprove && (
        <Button size="sm" onClick={onApprove} fullWidth>Review Request</Button>
      )}

      <div className="text-[10px] text-navy-600 font-mono mt-2">
        Submitted {formatDate(swap.createdAt)}
        {swap.resolvedAt && ` · Resolved ${formatDate(swap.resolvedAt)}`}
      </div>
    </Card>
  );
}
