import { choose, createArena, getMatch, skip } from '../arena/engine.ts';
import type { ArenaFrame, ArenaState, CatalogSnapshot, Side } from '../shared/contracts.ts';

export interface StageSelection {
  id: string;
  candidateIds: string[];
}

type Decision = Side | 'skip';
interface SavedSession {
  version: 2;
  contextKey: string;
  activeStageIndex: number;
  stages: (StageSelection & { decisions: Decision[]; pairs: [string, string][] })[];
}

function validateStages(snapshot: CatalogSnapshot, stages: StageSelection[]): void {
  if (!snapshot.complete) throw new Error('菜单尚未完整装载，请重新加载后开始挑选。');
  if (stages.length === 0) throw new Error('请至少选择一个分类。');
  const seen = new Set<string>();
  const items = new Map(snapshot.items.map(item => [item.id, item]));
  for (const stage of stages) {
    if (seen.has(stage.id)) throw new Error('同一分类不能重复选择。');
    seen.add(stage.id);
    if (stage.candidateIds.length === 0) throw new Error('每个分类至少保留一份餐品。');
    if (stage.candidateIds.some(id => items.get(id)?.stageId !== stage.id)) {
      throw new Error('候选餐品已失效，请重新选择分类。');
    }
  }
}

export function startSession(snapshot: CatalogSnapshot, stages: StageSelection[]): ArenaState[] {
  validateStages(snapshot, stages);
  return stages.map(stage => createArena(stage.candidateIds, crypto.randomUUID(), stage.id));
}

function decisionsOf(frames: ArenaFrame[]): Decision[] {
  return frames.slice(1).map((next, index) => {
    const previous = frames[index];
    if (next.status === 'skipped') return 'skip';
    return next.remainingIds.includes(previous.pair![0]) ? 'left' : 'right';
  });
}

export function serializeSession(snapshot: CatalogSnapshot, arenas: ArenaState[], activeStageIndex: number): string {
  const saved: SavedSession = {
    version: 2,
    contextKey: snapshot.contextKey,
    activeStageIndex,
    stages: arenas.map(arena => {
      const frames = [...arena.history, arena];
      return {
        id: arena.stageId,
        candidateIds: arena.orderedIds,
        decisions: decisionsOf(frames),
        pairs: frames.flatMap(frame => frame.pair ? [[...frame.pair] as [string, string]] : []),
      };
    }),
  };
  return JSON.stringify(saved);
}

export function resumeSession(snapshot: CatalogSnapshot, inMemory: string | null, persisted: string | null): { arenas: ArenaState[]; activeStageIndex: number } | null {
  const serialized = inMemory ?? persisted;
  return serialized === null ? null : restoreSession(snapshot, serialized);
}

export function restoreSession(snapshot: CatalogSnapshot, serialized: string): { arenas: ArenaState[]; activeStageIndex: number } {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error('暂存记录无法读取，请重新开始。'); }
  if (isRecord(value) && value.version === 1) throw new Error('挑选规则已更新，旧版挑选记录无法继续，请重新开始。');
  if (!isRecord(value) || value.version !== 2 || value.contextKey !== snapshot.contextKey || !Array.isArray(value.stages)) {
    throw new Error('菜单或暂存记录已变化，请重新选择分类。');
  }
  const stages = value.stages.map((stage): SavedSession['stages'][number] => {
    if (!isRecord(stage) || typeof stage.id !== 'string' || !Array.isArray(stage.candidateIds) ||
        !stage.candidateIds.every(id => typeof id === 'string') || !Array.isArray(stage.decisions) ||
        !stage.decisions.every(side => side === 'left' || side === 'right' || side === 'skip') ||
        !Array.isArray(stage.pairs) || !stage.pairs.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(id => typeof id === 'string'))) {
      throw new Error('暂存记录中的候选、抽签或决定无效，请重新开始。');
    }
    if (new Set(stage.candidateIds).size !== stage.candidateIds.length || stage.decisions.length > stage.candidateIds.length || stage.pairs.length > Math.max(0, stage.candidateIds.length - 1)) {
      throw new Error('暂存挑选记录超出候选范围，请重新开始。');
    }
    return { id: stage.id, candidateIds: stage.candidateIds as string[], decisions: stage.decisions as Decision[], pairs: stage.pairs as [string, string][] };
  });
  if (!Number.isInteger(value.activeStageIndex) || (value.activeStageIndex as number) < 0 || (value.activeStageIndex as number) >= stages.length) {
    throw new Error('暂存挑选记录无效，请重新开始。');
  }
  validateStages(snapshot, stages);
  const arenas = stages.map(stage => {
    let drawIndex = 0;
    const draw = () => stage.pairs[drawIndex++];
    let arena = createArena(stage.candidateIds, crypto.randomUUID(), stage.id, draw);
    for (const [decisionIndex, decision] of stage.decisions.entries()) {
      if (decision === 'skip') {
        if (arena.status === 'skipped' || decisionIndex !== stage.decisions.length - 1) {
          throw new Error('跳过记录无效，请重新开始。');
        }
        arena = skip(arena);
      } else {
        if (getMatch(arena) === null) throw new Error('决定记录超出挑选记录，请重新开始。');
        arena = choose(arena, decision, arena.revision, draw);
      }
    }
    if (drawIndex !== stage.pairs.length) throw new Error('暂存抽签记录超出挑选记录，请重新开始。');
    return arena;
  });
  return { arenas, activeStageIndex: value.activeStageIndex as number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
