import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Layout } from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SchedulePage from './pages/SchedulePage';
import AvailabilityPage from './pages/AvailabilityPage';
import SwapsPage from './pages/SwapsPage';
import OpenShiftsPage from './pages/OpenShiftsPage';
import FairnessPage from './pages/FairnessPage';
import SettingsPage from './pages/SettingsPage';
import EmployeeApprovalsPage from './pages/EmployeeApprovalsPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import { LoadingSpinner } from './components/common/LoadingSpinner';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { currentUser, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-navy-950 flex items-center justify-center"><LoadingSpinner /></div>;
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role === 'employee' && (!currentUser.isApproved || !currentUser.isRealSignup)) return <PendingApproval />;
  return <Layout>{children}</Layout>;
}

function PendingApproval() { const { logout, currentUser } = useAuth(); const rejected = currentUser?.registrationStatus === 'rejected' || !currentUser?.isRealSignup; return <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4"><div className="max-w-md bg-navy-800 border border-navy-700 rounded-xl p-6 text-center"><h1 className="text-xl font-bold text-navy-100">{rejected ? 'Employee registration not approved' : 'Waiting for manager approval'}</h1><p className="mt-3 text-sm text-navy-400">{rejected ? 'Your registration was not approved. Please contact your manager if you believe this is an error.' : 'Your employee account has been created. You will be able to use schedules and availability once a manager approves it.'}</p><button onClick={logout} className="mt-5 text-sm text-brand-400">Sign out</button></div></div>; }

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { currentUser, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-navy-950 flex items-center justify-center"><LoadingSpinner /></div>;
  if (currentUser) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/dashboard"    element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/schedule"     element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />
      <Route path="/availability" element={<ProtectedRoute><AvailabilityPage /></ProtectedRoute>} />
      <Route path="/swaps"        element={<ProtectedRoute><SwapsPage /></ProtectedRoute>} />
      <Route path="/open-shifts"  element={<ProtectedRoute><OpenShiftsPage /></ProtectedRoute>} />
      <Route path="/fairness"     element={<ProtectedRoute><FairnessPage /></ProtectedRoute>} />
      <Route path="/employee-approvals" element={<ProtectedRoute><EmployeeApprovalsPage /></ProtectedRoute>} />
      <Route path="/settings"     element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="*"             element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
