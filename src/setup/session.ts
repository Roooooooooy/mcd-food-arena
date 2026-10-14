import { choose, createArena, getMatch, skip } from '../arena/engine.ts';
import type { ArenaFrame, ArenaState, CatalogSnapshot, Side } from '../shared/contracts.ts';

export interface StageSelection {
  id: string;
  candidateIds: string[];
}

type Decision = Side | 'skip';
interface SavedSession {
  version: 1;
  contextKey: string;
  activeStageIndex: number;
  stages: (StageSelection & { decisions: Decision[] })[];
}

export function startSession(snapshot: CatalogSnapshot, stages: StageSelection[]): ArenaState[] {
  if (!snapshot.complete) throw new Error('菜单尚未完整装载，请重新加载后开赛。');
  if (stages.length === 0) throw new Error('请至少选择一个赛区。');
  const seen = new Set<string>();
  const items = new Map(snapshot.items.map(item => [item.id, item]));
  return stages.map(stage => {
    if (seen.has(stage.id)) throw new Error('同一赛区不能重复选择。');
    seen.add(stage.id);
    if (stage.candidateIds.length === 0) throw new Error('每个赛区至少保留一份餐品。');
    if (stage.candidateIds.some(id => items.get(id)?.stageId !== stage.id)) {
      throw new Error('候选餐品已失效，请重新选择赛区。');
    }
    return createArena(stage.candidateIds, crypto.randomUUID(), stage.id);
  });
}

function decisionsOf(state: ArenaState): Decision[] {
  const frames: ArenaFrame[] = [...state.history, state];
  return frames.slice(1).map((next, index) => {
    const previous = frames[index];
    if (next.status === 'skipped') return 'skip';
    return next.championId === previous.championId ? 'left' : 'right';
  });
}

export function serializeSession(snapshot: CatalogSnapshot, arenas: ArenaState[], activeStageIndex: number): string {
  const saved: SavedSession = {
    version: 1,
    contextKey: snapshot.contextKey,
    activeStageIndex,
    stages: arenas.map(arena => ({ id: arena.stageId, candidateIds: arena.orderedIds, decisions: decisionsOf(arena) })),
  };
  return JSON.stringify(saved);
}

export function resumeSession(snapshot: CatalogSnapshot, inMemory: string | null, persisted: string | null): { arenas: ArenaState[]; activeStageIndex: number } | null {
  const serialized = inMemory ?? persisted;
  return serialized === null ? null : restoreSession(snapshot, serialized);
}

export function restoreSession(snapshot: CatalogSnapshot, serialized: string): { arenas: ArenaState[]; activeStageIndex: number } {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error('暂存记录无法读取，请重新开局。'); }
  if (!isRecord(value) || value.version !== 1 || value.contextKey !== snapshot.contextKey || !Array.isArray(value.stages)) {
    throw new Error('菜单或暂存记录已变化，请重新选择赛区。');
  }
  const stages = value.stages.map((stage): SavedSession['stages'][number] => {
    if (!isRecord(stage) || typeof stage.id !== 'string' || !Array.isArray(stage.candidateIds) ||
        !stage.candidateIds.every(id => typeof id === 'string') || !Array.isArray(stage.decisions) ||
        !stage.decisions.every(side => side === 'left' || side === 'right' || side === 'skip')) {
      throw new Error('暂存记录中的候选或决定无效，请重新开局。');
    }
    return { id: stage.id, candidateIds: stage.candidateIds as string[], decisions: stage.decisions as Decision[] };
  });
  if (!Number.isInteger(value.activeStageIndex) || (value.activeStageIndex as number) < 0 || (value.activeStageIndex as number) >= stages.length) {
    throw new Error('暂存赛程无效，请重新开局。');
  }
  const arenas = startSession(snapshot, stages).map((initial, index) => {
    let arena = initial;
    for (const [decisionIndex, decision] of stages[index].decisions.entries()) {
      if (decision === 'skip') {
        if (arena.status === 'skipped' || decisionIndex !== stages[index].decisions.length - 1) {
          throw new Error('跳过记录无效，请重新开局。');
        }
        arena = skip(arena);
      } else {
        if (getMatch(arena) === null) throw new Error('决定记录超出赛程，请重新开局。');
        arena = choose(arena, decision, arena.revision);
      }
    }
    return arena;
  });
  return { arenas, activeStageIndex: value.activeStageIndex as number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
