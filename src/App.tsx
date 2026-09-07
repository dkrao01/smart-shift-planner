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
import { LoadingSpinner } from './components/common/LoadingSpinner';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { currentUser, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-navy-950 flex items-center justify-center"><LoadingSpinner /></div>;
  if (!currentUser) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { currentUser, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-navy-950 flex items-center justify-center"><LoadingSpinner /></div>;
  if (currentUser) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/dashboard"    element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/schedule"     element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />
      <Route path="/availability" element={<ProtectedRoute><AvailabilityPage /></ProtectedRoute>} />
      <Route path="/swaps"        element={<ProtectedRoute><SwapsPage /></ProtectedRoute>} />
      <Route path="/open-shifts"  element={<ProtectedRoute><OpenShiftsPage /></ProtectedRoute>} />
      <Route path="/fairness"     element={<ProtectedRoute><FairnessPage /></ProtectedRoute>} />
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
