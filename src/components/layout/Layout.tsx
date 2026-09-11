import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { useNavCounts } from '../../hooks/useNavCounts';

export function Layout({ children }: { children: React.ReactNode }) {
  const navCounts = useNavCounts();
  return (
    <div className="min-h-screen bg-navy-950 flex">
      {/* Desktop sidebar */}
      <Sidebar counts={navCounts} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* Mobile header */}
        <Header />

        {/* Page content */}
        <main className="flex-1 px-4 py-5 md:px-6 md:py-6 pb-24 md:pb-6 overflow-x-hidden">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <BottomNav counts={navCounts} />
    </div>
  );
}
