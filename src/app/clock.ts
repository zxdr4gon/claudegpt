import type { Clock } from '../model/items';
import { currentTimeZone } from '../parser/time';

export const systemClock = (): Clock => ({ now: Date.now(), tz: currentTimeZone() });
