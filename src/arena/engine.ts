import type { ArenaFrame, ArenaMatch, ArenaState, Side } from '../shared/contracts.ts';

export type DrawPair = (ids: readonly string[]) => readonly [string, string];

function randomWord(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function randomIndex(length: number, nextWord: () => number): number {
  const range = 0x100000000;
  const limit = range - range % length;
  // Reject the incomplete tail rather than giving some candidates an extra chance.
  for (;;) {
    const word = nextWord();
    if (!Number.isInteger(word) || word < 0 || word >= range) throw new Error('抽签随机数无效。');
    if (word < limit) return word % length;
  }
}

export function drawRandomPair(ids: readonly string[], nextWord = randomWord): [string, string] {
  if (ids.length < 2) throw new Error('至少两份候选才能抽签。');
  const leftIndex = randomIndex(ids.length, nextWord);
  const rightSlot = randomIndex(ids.length - 1, nextWord);
  const rightIndex = rightSlot >= leftIndex ? rightSlot + 1 : rightSlot;
  return [ids[leftIndex], ids[rightIndex]];
}

function drawMatch(ids: string[], draw: DrawPair): [string, string] | null {
  if (ids.length < 2) return null;
  const pair = draw([...ids]);
  if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1] || !pair.every(id => ids.includes(id))) {
    throw new Error('抽签对阵无效，请重新开局。');
  }
  return [pair[0], pair[1]];
}

export function createArena(ids: string[], arenaId: string, stageId: string, draw: DrawPair = drawRandomPair): ArenaState {
  const orderedIds = [...new Set(ids)];
  return {
    arenaId,
    stageId,
    orderedIds,
    remainingIds: [...orderedIds],
    pair: drawMatch(orderedIds, draw),
    championId: orderedIds.length === 1 ? orderedIds[0] : null,
    status: orderedIds.length === 0 ? 'empty' : orderedIds.length === 1 ? 'complete' : 'active',
    revision: 0,
    history: [],
  };
}

export function getMatch(state: ArenaState): ArenaMatch | null {
  if (state.status !== 'active' || state.pair === null) return null;
  return { leftId: state.pair[0], rightId: state.pair[1], revision: state.revision };
}

export function completedChoices(state: ArenaState): number {
  return state.orderedIds.length - state.remainingIds.length;
}

export function choose(state: ArenaState, side: Side, expectedRevision: number, draw: DrawPair = drawRandomPair): ArenaState {
  if (expectedRevision !== state.revision || (side !== 'left' && side !== 'right')) return state;
  const match = getMatch(state);
  if (match === null) return state;

  const loserId = side === 'left' ? match.rightId : match.leftId;
  const remainingIds = state.remainingIds.filter(id => id !== loserId);
  return {
    ...state,
    remainingIds,
    pair: drawMatch(remainingIds, draw),
    championId: remainingIds.length === 1 ? remainingIds[0] : null,
    status: remainingIds.length === 1 ? 'complete' : 'active',
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
    remainingIds: [...previous.remainingIds],
    pair: previous.pair ? [...previous.pair] : null,
    revision: state.revision + 1,
    history: state.history.slice(0, -1),
  };
}

export function skip(state: ArenaState): ArenaState {
  if (state.status === 'skipped') return state;
  return {
    ...state,
    championId: null,
    pair: null,
    status: 'skipped',
    revision: state.revision + 1,
    history: [...state.history, frameOf(state)],
  };
}

function frameOf(state: ArenaState): ArenaFrame {
  return {
    championId: state.championId,
    remainingIds: [...state.remainingIds],
    pair: state.pair ? [...state.pair] : null,
    status: state.status,
  };
}
