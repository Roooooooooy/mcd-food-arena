import { getMatch } from './engine.ts';
import type { ArenaState, Side } from '../shared/contracts.ts';

export interface CoinLock {
  arenaId: string;
  revision: number;
  finalSide: Side;
}

export function sideFromByte(value: number): Side {
  return value % 2 === 0 ? 'left' : 'right';
}

export function coinTimeline(finalSide: Side): { side: Side; atMs: number }[] {
  const gaps = [45, 55, 70, 90, 115, 145, 180, 225, 280, 340];
  let atMs = 0;
  // Ten alternating stops: choose the starting side so the last is sealed.
  return gaps.map((gap, index) => {
    atMs += gap;
    return { side: index % 2 === 1 ? finalSide : finalSide === 'left' ? 'right' : 'left', atMs };
  });
}

export function coinFlightPath(finalSide: Side): { side: Side | null; atMs: number; height: number }[] {
  const heights = [12, 20, 24, 20, 16, 12, 8, 6, 3, 0];
  return [{ side: null, atMs: 0, height: 0 }, ...coinTimeline(finalSide).map((stop, index) => ({ ...stop, height: heights[index] }))];
}

export function lockMatchesArena(lock: CoinLock, state: ArenaState): boolean {
  return lock.arenaId === state.arenaId && lock.revision === state.revision && getMatch(state) !== null;
}
