import type { ArenaFrame, ArenaMatch, ArenaState, Side } from '../shared/contracts.ts';

export function createArena(ids: string[], arenaId: string, stageId: string): ArenaState {
  const orderedIds = [...new Set(ids)];
  return {
    arenaId,
    stageId,
    orderedIds,
    championId: orderedIds[0] ?? null,
    challengerIndex: orderedIds.length === 0 ? 0 : 1,
    status: orderedIds.length === 0 ? 'empty' : orderedIds.length === 1 ? 'complete' : 'active',
    revision: 0,
    history: [],
  };
}

export function getMatch(state: ArenaState): ArenaMatch | null {
  const challengerId = state.orderedIds[state.challengerIndex];
  if (state.status !== 'active' || state.championId === null || challengerId === undefined) {
    return null;
  }
  return { leftId: state.championId, rightId: challengerId, revision: state.revision };
}

export function choose(state: ArenaState, side: Side, expectedRevision: number): ArenaState {
  if (expectedRevision !== state.revision) return state;
  const match = getMatch(state);
  if (match === null) return state;

  const challengerIndex = state.challengerIndex + 1;
  return {
    ...state,
    championId: side === 'left' ? match.leftId : match.rightId,
    challengerIndex,
    status: challengerIndex >= state.orderedIds.length ? 'complete' : 'active',
    revision: state.revision + 1,
    history: [...state.history, frameOf(state)],
  };
}

export function undo(state: ArenaState): ArenaState {
  const previous = state.history.at(-1);
  if (previous === undefined) return state;
  return {
    ...state,
    ...previous,
    revision: state.revision + 1,
    history: state.history.slice(0, -1),
  };
}

export function skip(state: ArenaState): ArenaState {
  if (state.status === 'skipped') return state;
  return {
    ...state,
    championId: null,
    status: 'skipped',
    revision: state.revision + 1,
    history: [...state.history, frameOf(state)],
  };
}

function frameOf(state: ArenaState): ArenaFrame {
  return {
    championId: state.championId,
    challengerIndex: state.challengerIndex,
    status: state.status,
  };
}
