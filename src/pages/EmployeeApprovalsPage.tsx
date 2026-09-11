import React, { useEffect, useState } from 'react';
import { getPendingEmployees, approveEmployeeAccount, rejectEmployeeAccount, getApprovedEmployees, revokeEmployeeAccess } from '../services/dataService';
import type { Employee } from '../types';
import { Card } from '../components/common/Card';
import { PageHeader, LoadingSpinner, EmptyState } from '../components/common/LoadingSpinner';
import { Button } from '../components/common/Button';

export default function EmployeeApprovalsPage() {
  const [pending, setPending] = useState<Employee[]>([]);
  const [approved, setApproved] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const [pendingAccounts, approvedAccounts] = await Promise.all([getPendingEmployees(), getApprovedEmployees()]);
      setPending(pendingAccounts); setApproved(approvedAccounts);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load employee accounts.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  async function act(employee: Employee, action: () => Promise<void>) { setBusy(employee.id); try { await action(); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not update access.'); } finally { setBusy(''); } }

  if (loading) return <LoadingSpinner />;
  return <div className="space-y-6">
    <PageHeader title="Employee Access" subtitle={`Approved employees: ${approved.length} · Pending approvals: ${pending.length}`} />
    {error && <p className="text-rose-300 text-sm">{error}</p>}
    <section className="space-y-3"><h2 className="text-sm font-semibold text-navy-200">Pending employee registrations</h2>{!pending.length ? <EmptyState icon="?" title="No pending employees" description="New real employee registrations will appear here." /> : pending.map(employee => <Card key={employee.id}><div className="flex items-center justify-between gap-3"><div><p className="text-navy-100 font-medium">{employee.name}</p><p className="text-xs text-navy-500">{employee.email}</p></div><div className="flex gap-2"><Button size="sm" variant="danger" disabled={!!busy} onClick={() => act(employee, () => rejectEmployeeAccount(employee.uid!, employee.id))}>Reject</Button><Button size="sm" loading={busy === employee.id} disabled={!!busy} onClick={() => act(employee, () => approveEmployeeAccount(employee.uid!, employee.id))}>Approve</Button></div></div></Card>)}</section>
    <section className="space-y-3"><h2 className="text-sm font-semibold text-navy-200">Approved employees with portal access</h2>{!approved.length ? <EmptyState icon="?" title="No approved employees" description="Approve a real employee registration to grant portal access." /> : approved.map(employee => <Card key={employee.id}><div className="flex items-center justify-between gap-3"><div><p className="text-navy-100 font-medium">{employee.name}</p><p className="text-xs text-navy-500">{employee.email}</p></div><Button size="sm" variant="danger" loading={busy === employee.id} disabled={!!busy} onClick={() => act(employee, () => revokeEmployeeAccess(employee.uid!, employee.id))}>Remove access</Button></div></Card>)}</section>
  </div>;
}