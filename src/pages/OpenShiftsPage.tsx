import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardHeader } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { LoadingSpinner, EmptyState, PageHeader, WarningBanner } from '../components/common/LoadingSpinner';
import { Button } from '../components/common/Button';
import { Modal, FormField, Select, Textarea } from '../components/common/Modal';
import {
  getEmployees, getAssignments, getOpenShifts,
  createOpenShift, requestOpenShiftPickup, resolveOpenShiftPickup
} from '../services/dataService';
import { validateOpenShiftPickup } from '../utils/scheduleUtils';
import { formatDate } from '../utils/dateUtils';
import type { Employee, ShiftAssignment, OpenShiftRequest, ShiftType } from '../types';

const SHIFT_ICONS: Record<ShiftType, string> = { day: '☀', evening: '🌆', night: '🌙' };

export default function OpenShiftsPage() {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [openShifts, setOpenShifts] = useState<OpenShiftRequest[]>([]);
  const [placeModal, setPlaceModal] = useState(false);
  const [approveModal, setApproveModal] = useState<OpenShiftRequest | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [placeReason, setPlaceReason] = useState('');
  const [managerNote, setManagerNote] = useState('');
  const [saving, setSaving] = useState(false);

  const isManager = currentUser?.role === 'manager';
  const myEmpId = currentUser?.employeeId ?? '';

  async function load() {
    const [emps, asgn, opens] = await Promise.all([
      getEmployees(), getAssignments(), getOpenShifts()
    ]);
    setEmployees(emps); setAssignments(asgn); setOpenShifts(opens);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const myShifts = assignments.filter(a => a.employeeId === myEmpId);
  // Open shifts I didn't create and haven't already been requested
  const availableToPickup = openShifts.filter(
    o => o.originalEmployeeId !== myEmpId && o.status === 'open'
  );

  function getEmpName(id: string) { return employees.find(e => e.id === id)?.name ?? id; }
  function getShift(id: string) { return assignments.find(a => a.id === id); }

  function getShiftLabel(a: ShiftAssignment) {
    return `${SHIFT_ICONS[a.shiftType]} ${formatDate(a.date)} — ${a.shiftType} (${a.hours}h)`;
  }

  async function handlePlaceShift() {
    if (!selectedShiftId || !placeReason || !currentUser) return;
    setSaving(true);
    await createOpenShift({
      originalEmployeeId: myEmpId,
      shiftId: selectedShiftId,
      status: 'open',
      reason: placeReason,
      validationWarnings: [],
      createdAt: new Date().toISOString(),
    });
    await load();
    setSaving(false);
    setPlaceModal(false);
    setSelectedShiftId(''); setPlaceReason('');
  }

  async function handleRequestPickup(openShiftId: string) {
    setSaving(true);
    await requestOpenShiftPickup(openShiftId, myEmpId);
    await load();
    setSaving(false);
  }

  async function handleResolve(id: string, approved: boolean) {
    setSaving(true);
    await resolveOpenShiftPickup(id, approved, currentUser!.uid, managerNote);
    await load();
    setSaving(false);
    setApproveModal(null);
    setManagerNote('');
  }

  function getValidationForPickup(openShift: OpenShiftRequest): string[] {
    if (!openShift.shiftId) return [];
    const warnings = validateOpenShiftPickup(assignments, employees, openShift.shiftId, myEmpId, '');
    return warnings.map(w => w.message);
  }

  if (loading) return <LoadingSpinner label="Loading open shifts…" />;

  const pendingApprovals = openShifts.filter(o => o.pickupStatus === 'pending');
  const openPool = openShifts.filter(o => o.status === 'open' || o.status === 'requested');
  const resolved = openShifts.filter(o => o.status === 'filled' || o.status === 'rejected' || o.status === 'cancelled');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Open Shift Pool"
        subtitle={`${openPool.length} open · ${pendingApprovals.length} awaiting approval`}
        action={
          !isManager && (
            <Button size="sm" onClick={() => setPlaceModal(true)} icon="◯">
              Place Shift
            </Button>
          )
        }
      />

      {/* Manager: pending approvals */}
      {isManager && pendingApprovals.length > 0 && (
        <div>
          <h3 className="text-xs font-mono text-navy-500 uppercase tracking-wide mb-2">Pending Approvals</h3>
          <div className="space-y-3">
            {pendingApprovals.map(o => (
              <OpenShiftCard
                key={o.id}
                item={o}
                employees={employees}
                assignments={assignments}
                isManager={isManager}
                onApprove={() => setApproveModal(o)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Open pool */}
      {openPool.length > 0 && (
        <div>
          <h3 className="text-xs font-mono text-navy-500 uppercase tracking-wide mb-2">Available Shifts</h3>
          <div className="space-y-3">
            {openPool.map(o => {
              const pickupWarnings = !isManager ? getValidationForPickup(o) : [];
              return (
                <OpenShiftCard
                  key={o.id}
                  item={o}
                  employees={employees}
                  assignments={assignments}
                  isManager={isManager}
                  currentEmpId={myEmpId}
                  pickupWarnings={pickupWarnings}
                  onPickup={!isManager && o.status === 'open' ? () => handleRequestPickup(o.id) : undefined}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Resolved */}
      {resolved.length > 0 && (
        <div>
          <h3 className="text-xs font-mono text-navy-500 uppercase tracking-wide mb-2">History</h3>
          <div className="space-y-2">
            {resolved.map(o => (
              <OpenShiftCard key={o.id} item={o} employees={employees} assignments={assignments} isManager={isManager} />
            ))}
          </div>
        </div>
      )}

      {openShifts.length === 0 && (
        <EmptyState icon="◯" title="No open shifts" description="When an employee can't attend a shift, they can place it here for someone else to pick up." />
      )}

      {/* Place Shift Modal */}
      <Modal
        isOpen={placeModal}
        onClose={() => setPlaceModal(false)}
        title="Place Shift in Open Pool"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPlaceModal(false)}>Cancel</Button>
            <Button variant="primary" size="sm" loading={saving} disabled={!selectedShiftId || !placeReason} onClick={handlePlaceShift}>
              Place in Pool
            </Button>
          </>
        }
      >
        <div className="bg-amber-900/20 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-300 mb-4">
          ⚠ Once placed, a manager must approve any pickup. This does NOT automatically remove you from the shift.
        </div>

        <FormField label="Which shift can't you attend?">
          <Select value={selectedShiftId} onChange={e => setSelectedShiftId(e.target.value)}>
            <option value="">Select your shift…</option>
            {myShifts.map(a => (
              <option key={a.id} value={a.id}>{getShiftLabel(a)}</option>
            ))}
          </Select>
        </FormField>

        <FormField label="Reason">
          <Textarea
            value={placeReason}
            onChange={e => setPlaceReason(e.target.value)}
            placeholder="e.g. Sudden illness, family emergency…"
            rows={3}
          />
        </FormField>
      </Modal>

      {/* Manager Approve Modal */}
      {isManager && approveModal && (
        <Modal
          isOpen={!!approveModal}
          onClose={() => { setApproveModal(null); setManagerNote(''); }}
          title="Review Open Shift Pickup"
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
          <div className="bg-navy-900 rounded-lg p-3 text-sm space-y-2 mb-4">
            <div className="flex gap-2"><span className="text-navy-500 w-28">Original emp:</span><span className="text-navy-200">{getEmpName(approveModal.originalEmployeeId)}</span></div>
            {approveModal.pickupEmployeeId && (
              <div className="flex gap-2"><span className="text-navy-500 w-28">Pickup emp:</span><span className="text-navy-200">{getEmpName(approveModal.pickupEmployeeId)}</span></div>
            )}
            <div className="flex gap-2"><span className="text-navy-500 w-28">Shift:</span><span className="text-navy-200">{getShiftLabel(getShift(approveModal.shiftId)!)}</span></div>
            <div className="flex gap-2"><span className="text-navy-500 w-28">Reason:</span><span className="text-navy-200">{approveModal.reason}</span></div>
          </div>
          {approveModal.validationWarnings?.map((w, i) => (
            <WarningBanner key={i} message={w} type="warning" />
          ))}
          <FormField label="Manager decision note">
            <Textarea
              value={managerNote}
              onChange={e => setManagerNote(e.target.value)}
              placeholder="Explain the approval or rejection…"
              rows={2}
            />
          </FormField>
        </Modal>
      )}
    </div>
  );
}

// ─── Open Shift Card ──────────────────────────────────────────────────────────

function OpenShiftCard({
  item, employees, assignments, isManager, currentEmpId,
  pickupWarnings, onPickup, onApprove
}: {
  item: OpenShiftRequest;
  employees: Employee[];
  assignments: ShiftAssignment[];
  isManager: boolean;
  currentEmpId?: string;
  pickupWarnings?: string[];
  onPickup?: () => void;
  onApprove?: () => void;
}) {
  function getEmpName(id: string) { return employees.find(e => e.id === id)?.name ?? id; }
  const shift = assignments.find(a => a.id === item.shiftId);

  const statusVariant = item.status === 'open' ? 'info'
    : item.status === 'requested' ? 'pending'
    : item.status === 'filled' ? 'approved'
    : 'rejected';

  return (
    <Card bordered>
      <div className="flex items-start justify-between mb-2">
        <div className="text-sm font-semibold text-navy-100">
          {shift ? (
            <>{SHIFT_ICONS[shift.shiftType]} {shift.shiftType.charAt(0).toUpperCase() + shift.shiftType.slice(1)} · {formatDate(shift.date)} ({shift.hours}h)</>
          ) : 'Unknown Shift'}
        </div>
        <Badge variant={statusVariant}>
          {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
        </Badge>
      </div>

      <div className="text-xs text-navy-400 mb-2">
        <span className="text-navy-500">Posted by: </span>{getEmpName(item.originalEmployeeId)}
        {item.pickupEmployeeId && (
          <> · <span className="text-navy-500">Requested by: </span>{getEmpName(item.pickupEmployeeId)}</>
        )}
      </div>

      <div className="text-xs text-navy-400 italic mb-2">"{item.reason}"</div>

      {(item.validationWarnings?.length ?? 0) > 0 && (
        <div className="space-y-1 mb-2">
          {item.validationWarnings?.map((w, i) => <WarningBanner key={i} message={w} type="warning" />)}
        </div>
      )}

      {item.managerNote && (
        <div className="text-xs text-navy-300 bg-navy-900 rounded px-2 py-1.5 mb-2">
          <span className="text-navy-500">Manager decision: </span>{item.managerNote}
        </div>
      )}

      {pickupWarnings && pickupWarnings.length > 0 && (
        <div className="space-y-1 mb-2">
          {pickupWarnings.map((w, i) => <WarningBanner key={i} message={w} type="warning" />)}
        </div>
      )}

      <div className="flex gap-2 mt-2">
        {onPickup && item.originalEmployeeId !== currentEmpId && (
          <Button size="sm" variant="secondary" onClick={onPickup} fullWidth>
            Request to Pick Up
          </Button>
        )}
        {isManager && onApprove && (
          <Button size="sm" onClick={onApprove} fullWidth>
            Review Pickup
          </Button>
        )}
      </div>

      <div className="text-[10px] text-navy-600 font-mono mt-2">
        Created {formatDate(item.createdAt)}
      </div>
    </Card>
  );
}
