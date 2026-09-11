import React from 'react';
import { NavLink } from 'react-router-dom';
import type { NavCounts } from '../../hooks/useNavCounts';

const BOTTOM_NAV = [
  { to: '/dashboard',    icon: '◈', label: 'Home' },
  { to: '/schedule',     icon: '▦', label: 'Schedule' },
  { to: '/swaps',        icon: '⇄', label: 'Swaps' },
  { to: '/open-shifts',  icon: '◯', label: 'Open' },
  { to: '/fairness',     icon: '⚖', label: 'Hours' },
];

export function BottomNav({ counts }: { counts: NavCounts }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-navy-900 border-t border-navy-700/60 safe-area-inset-bottom">
      <div className="flex items-stretch">
        {BOTTOM_NAV.map(item => {
          const count = item.to === '/open-shifts' ? counts.openShifts : item.to === '/swaps' ? counts.swaps : 0;
          return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-[10px] font-mono transition-colors
               ${isActive ? 'text-brand-400' : 'text-navy-500 hover:text-navy-300'}`
            }
          >
            <span className="relative text-base leading-none">{item.icon}{count > 0 && <span className="absolute -top-2 -right-3 min-w-3.5 h-3.5 px-0.5 rounded-full bg-brand-500 text-white text-[8px] leading-[14px]">{count > 9 ? '9+' : count}</span>}</span>
            <span>{item.label}</span>
          </NavLink>
          );
        })}
      </div>
      {/* Safe area padding for iOS */}
      <div className="h-safe-area-inset-bottom" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
    </nav>
  );
}
