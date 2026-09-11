import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import type { NavCounts } from '../../hooks/useNavCounts';

interface NavItem {
  to: string;
  icon: string;
  label: string;
  managerOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',    icon: '◈', label: 'Dashboard' },
  { to: '/schedule',     icon: '▦', label: 'Schedule' },
  { to: '/availability', icon: '✓', label: 'Availability' },
  { to: '/swaps',        icon: '⇄', label: 'Swap Requests' },
  { to: '/open-shifts',  icon: '◯', label: 'Open Shifts' },
  { to: '/fairness',     icon: '⚖', label: 'Hours & Fairness' },
  { to: '/settings',     icon: '≡', label: 'Rules & Info' },
];

export function Sidebar({ counts }: { counts: NavCounts }) {
  const { currentUser, logout, isDemo } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <aside className="hidden md:flex flex-col w-60 bg-navy-900 border-r border-navy-700/60 h-screen sticky top-0 shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-navy-700/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">S</div>
          <div>
            <div className="text-navy-50 font-semibold text-sm leading-none">Smart Shift</div>
            <div className="text-navy-500 text-[10px] font-mono mt-0.5">PLANNER</div>
          </div>
        </div>
        {isDemo && (
          <div className="mt-2 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded text-[10px] text-amber-400 font-mono">
            DEMO MODE
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const count = item.to === '/open-shifts' ? counts.openShifts : item.to === '/swaps' ? counts.swaps : 0;
          return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-100 font-sans group
               ${isActive
                 ? 'bg-brand-500/15 text-brand-400 font-medium'
                 : 'text-navy-400 hover:text-navy-100 hover:bg-navy-800'
               }`
            }
          >
            <span className="text-base leading-none font-mono w-5 text-center group-[.active]:text-brand-400">
              {item.icon}
            </span>
            {item.label}
            {count > 0 && <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-brand-500 text-white text-[10px] leading-5 text-center font-mono">{count > 99 ? '99+' : count}</span>}
          </NavLink>
          );
        })}
      </nav>

      {/* User info */}
      <div className="px-4 py-4 border-t border-navy-700/60">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-brand-400 font-bold text-sm">
            {currentUser?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-navy-200 truncate">{currentUser?.name}</div>
            <div className="text-[10px] text-navy-500 font-mono uppercase">{currentUser?.role}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full text-xs text-navy-500 hover:text-rose-400 transition-colors text-left font-mono"
        >
          → Sign out
        </button>
      </div>
    </aside>
  );
}
