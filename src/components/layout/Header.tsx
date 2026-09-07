import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':    'Dashboard',
  '/schedule':     'Schedule',
  '/availability': 'Availability',
  '/swaps':        'Swap Requests',
  '/open-shifts':  'Open Shifts',
  '/fairness':     'Hours & Fairness',
  '/settings':     'Rules & Info',
};

export function Header() {
  const location = useLocation();
  const { currentUser, logout, isDemo } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const title = PAGE_TITLES[location.pathname] ?? 'Smart Shift';

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const NAV_ITEMS = [
    { to: '/dashboard',    label: 'Dashboard' },
    { to: '/schedule',     label: 'Schedule' },
    { to: '/availability', label: 'Availability' },
    { to: '/swaps',        label: 'Swap Requests' },
    { to: '/open-shifts',  label: 'Open Shifts' },
    { to: '/fairness',     label: 'Hours & Fairness' },
    { to: '/settings',     label: 'Rules & Info' },
  ];

  return (
    <header className="md:hidden sticky top-0 z-30 bg-navy-900/95 backdrop-blur border-b border-navy-700/60">
      <div className="flex items-center justify-between px-4 h-14">
        {/* Left: logo + title */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-brand-500 rounded-md flex items-center justify-center text-white font-bold text-xs">S</div>
          <span className="text-navy-100 font-semibold text-sm">{title}</span>
          {isDemo && <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-mono border border-amber-500/20">DEMO</span>}
        </div>

        {/* Right: menu button */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="w-8 h-8 flex items-center justify-center text-navy-400 hover:text-navy-100"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {menuOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            }
          </svg>
        </button>
      </div>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="absolute top-14 left-0 right-0 bg-navy-900 border-b border-navy-700/60 z-50 shadow-xl">
          <div className="px-3 py-2 border-b border-navy-800">
            <div className="text-xs text-navy-400">{currentUser?.name} · <span className="font-mono uppercase">{currentUser?.role}</span></div>
          </div>
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `block px-4 py-3 text-sm border-b border-navy-800/50 transition-colors
                 ${isActive ? 'text-brand-400 bg-brand-500/5' : 'text-navy-300 hover:text-navy-100 hover:bg-navy-800'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <button
            onClick={handleLogout}
            className="block w-full px-4 py-3 text-sm text-rose-400 hover:bg-navy-800 text-left"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
