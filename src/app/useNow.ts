import { useEffect, useState } from 'react';
import type { Clock } from '../model/items';
import { systemClock } from './clock';

/**
 * The current clock, refreshed every 30 s and whenever the tab becomes
 * visible again, so views roll over at midnight and snoozes expire on time.
 */
export function useNow(): Clock {
  const [clock, setClock] = useState(systemClock);
  useEffect(() => {
    const tick = () => setClock(systemClock());
    const id = window.setInterval(tick, 30_000);
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return clock;
}
