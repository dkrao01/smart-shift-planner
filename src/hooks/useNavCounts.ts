import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getOpenShifts, getSwapRequests } from '../services/dataService';

export interface NavCounts {
  openShifts: number;
  swaps: number;
}

export function useNavCounts(): NavCounts {
  const { currentUser } = useAuth();
  const [counts, setCounts] = useState<NavCounts>({ openShifts: 0, swaps: 0 });

  useEffect(() => {
    if (!currentUser) { setCounts({ openShifts: 0, swaps: 0 }); return; }
    const user = currentUser;
    let active = true;
    async function load() {
      try {
        const [openShifts, swaps] = await Promise.all([getOpenShifts(), getSwapRequests()]);
        if (!active) return;
        setCounts({
          openShifts: openShifts.filter(shift => shift.status === 'open' || shift.status === 'requested').length,
          swaps: user.role === 'manager'
            ? swaps.filter(swap => swap.status === 'pending').length
            : swaps.filter(swap => swap.status === 'pending' && swap.targetId === user.employeeId).length,
        });
      } catch { /* Page-specific errors should not break navigation. */ }
    }
    load();
    const interval = window.setInterval(load, 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, [currentUser]);

  return counts;
}
