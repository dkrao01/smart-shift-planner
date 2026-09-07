import React from 'react';
import { NavLink } from 'react-router-dom';

const BOTTOM_NAV = [
  { to: '/dashboard',    icon: '◈', label: 'Home' },
  { to: '/schedule',     icon: '▦', label: 'Schedule' },
  { to: '/swaps',        icon: '⇄', label: 'Swaps' },
  { to: '/open-shifts',  icon: '◯', label: 'Open' },
  { to: '/fairness',     icon: '⚖', label: 'Hours' },
];

export function BottomNav() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-navy-900 border-t border-navy-700/60 safe-area-inset-bottom">
      <div className="flex items-stretch">
        {BOTTOM_NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-[10px] font-mono transition-colors
               ${isActive ? 'text-brand-400' : 'text-navy-500 hover:text-navy-300'}`
            }
          >
            <span className="text-base leading-none">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
      {/* Safe area padding for iOS */}
      <div className="h-safe-area-inset-bottom" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
    </nav>
  );
}
