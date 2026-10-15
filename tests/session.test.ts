import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog } from '../src/demo/menu.ts';
import { choose, createArena, getMatch, skip, undo } from '../src/arena/engine.ts';
import { startSession, serializeSession, restoreSession, resumeSession } from '../src/setup/session.ts';

const snapshot = demoCatalog();
const burgerIds = snapshot.items.filter(item => item.stageId === 'burger').map(item => item.id);
const drinkIds = snapshot.items.filter(item => item.stageId === 'drink').map(item => item.id);
const edges = (ids: readonly string[]): [string, string] => [ids.at(-1)!, ids[0]];

// Catches newly random draws replacing a saved match or historical match during restore.
test('恢复随机对阵、存活池和历史，并以新赛程身份拒绝旧回调', () => {
  let arena = createArena(drinkIds, 'original', 'drink', edges);
  arena = choose(choose(arena, 'right', 0, edges), 'left', 1, edges);
  const skipped = skip(createArena(burgerIds, 'original-burger', 'burger', edges));
  const saved = serializeSession(snapshot, [arena, skipped], 0);
  const restored = restoreSession(snapshot, saved);
  const match = getMatch(restored.arenas[0])!;
  assert.equal(match.leftId, drinkIds[3]);
  assert.equal(match.rightId, drinkIds[1]);
  assert.deepEqual(restored.arenas[0].remainingIds, [drinkIds[1], drinkIds[2], drinkIds[3]]);
  assert.deepEqual(restored.arenas[0].history, arena.history);
  assert.equal(restored.arenas[1].status, 'skipped');
  assert.equal(restored.activeStageIndex, 0);
  assert.notEqual(restored.arenas[0].arenaId, arena.arenaId);
  assert.equal(saved.includes('arenaId'), false);
  assert.equal(saved.includes('name'), false);
  assert.equal(saved.includes('referencePrice'), false);
  assert.equal(JSON.parse(saved).version, 2);
});

test('所选赛区顺序和所有候选保留，随机淘汰完成后生成唯一冠军', () => {
  const arenas = startSession(snapshot, [{ id: 'drink', candidateIds: drinkIds }, { id: 'burger', candidateIds: burgerIds }]);
  assert.deepEqual(arenas.map(arena => arena.stageId), ['drink', 'burger']);
  assert.deepEqual(arenas[0].orderedIds, drinkIds);
  let arena = arenas[0];
  const appeared = new Set<string>();
  while (getMatch(arena)) {
    const match = getMatch(arena)!;
    appeared.add(match.leftId); appeared.add(match.rightId);
    arena = choose(arena, 'right', arena.revision);
  }
  assert.equal(arena.history.length, 4);
  assert.ok(drinkIds.includes(arena.championId!));
  assert.equal(appeared.size, 5);
  const restored = restoreSession(snapshot, serializeSession(snapshot, [arena], 0)).arenas[0];
  assert.equal(restored.championId, arena.championId);
  assert.equal(getMatch(restored), null);
});

test('空、失效、跨赛区或重复赛区选择无法开赛', () => {
  for (const stages of [[], [{ id: 'burger', candidateIds: [] }], [{ id: 'burger', candidateIds: ['gone'] }], [{ id: 'burger', candidateIds: drinkIds }], [{ id: 'burger', candidateIds: burgerIds }, { id: 'burger', candidateIds: burgerIds }]]) {
    assert.throws(() => startSession(snapshot, stages));
  }
});

test('撤回再暂存只保留仍有效的决定及原对阵', () => {
  const initial = createArena(burgerIds, 'run-1', 'burger', edges);
  const undone = undo(choose(choose(initial, 'right', 0, edges), 'right', 1, edges));
  const restored = restoreSession(snapshot, serializeSession(snapshot, [undone], 0)).arenas[0];
  assert.deepEqual(restored.remainingIds, burgerIds.slice(0, -1));
  assert.deepEqual(getMatch(restored), { leftId: burgerIds[3], rightId: burgerIds[0], revision: 1 });
  assert.equal(restored.history.length, 1);
  const beforeFirst = undo(restored);
  assert.deepEqual(getMatch(beforeFirst), { leftId: burgerIds[4], rightId: burgerIds[0], revision: 2 });
});

test('菜单变化、无效决定、池外或重复对阵、额外抽签记录均拒绝恢复', () => {
  const initial = createArena(burgerIds, 'run-1', 'burger', edges);
  const arena = choose(initial, 'right', 0, edges);
  const saved = serializeSession(snapshot, [arena], 0);
  assert.throws(() => restoreSession({ ...snapshot, contextKey: 'different-menu' }, saved));
  assert.throws(() => restoreSession({ ...snapshot, items: snapshot.items.filter(i => i.id !== burgerIds[0]) }, saved));
  for (const mutate of [
    (s: any) => { s.stages[0].decisions = ['right', 'right', 'right', 'right', 'right']; },
    (s: any) => { s.stages[0].decisions = ['unknown']; },
    (s: any) => { s.stages[0].pairs[0] = [burgerIds[0], burgerIds[0]]; },
    (s: any) => { s.stages[0].pairs[1] = [burgerIds[4], burgerIds[0]]; },
    (s: any) => { s.stages[0].pairs[0] = ['gone', burgerIds[0]]; },
    (s: any) => { s.stages[0].pairs.push([burgerIds[0], burgerIds[1]]); },
    (s: any) => { s.stages[0].pairs.pop(); },
    (s: any) => { s.stages[0].decisions = ['skip', 'right']; },
    (s: any) => { s.activeStageIndex = 99; },
  ]) {
    const malformed = JSON.parse(saved); mutate(malformed);
    assert.throws(() => restoreSession(snapshot, JSON.stringify(malformed)));
  }
  assert.throws(() => restoreSession(snapshot, '{'));
  assert.throws(() => restoreSession(snapshot, 'null'));
});

test('旧守擂规则存档不会被当成随机淘汰赛重放', () => {
  const old = { version: 1, contextKey: snapshot.contextKey, activeStageIndex: 0, stages: [{ id: 'burger', candidateIds: burgerIds, decisions: ['right'] }] };
  assert.throws(() => restoreSession(snapshot, JSON.stringify(old)), /规则已更新/);
});

test('单份直接冠军以及完成后跳过都可以恢复和撤回', () => {
  const initial = createArena([burgerIds[0]], 'run-1', 'burger');
  const restored = restoreSession(snapshot, serializeSession(snapshot, [skip(initial)], 0)).arenas[0];
  assert.equal(restored.status, 'skipped');
  assert.equal(undo(restored).championId, burgerIds[0]);
  const complete = choose(createArena(burgerIds.slice(0, 2), 'run-2', 'burger', edges), 'right', 0);
  const skipped = restoreSession(snapshot, serializeSession(snapshot, [skip(complete)], 0)).arenas[0];
  assert.equal(undo(skipped).championId, burgerIds[0]);
});

test('存储写入失败时优先恢复较新的内存暂存，包括当时抽到的组合', () => {
  const initial = createArena(burgerIds, 'run-1', 'burger', edges);
  const olderPersisted = serializeSession(snapshot, [initial], 0);
  const paused = choose(initial, 'right', 0, edges);
  const latest = serializeSession(snapshot, [paused], 0);
  const restored = resumeSession(snapshot, latest, olderPersisted)!.arenas[0];
  assert.deepEqual(restored.remainingIds, burgerIds.slice(0, -1));
  assert.deepEqual(getMatch(restored), { leftId: burgerIds[3], rightId: burgerIds[0], revision: 1 });
  assert.notEqual(restored.arenaId, paused.arenaId);
  const fromDisk = resumeSession(snapshot, null, olderPersisted)!.arenas[0];
  assert.equal(fromDisk.history.length, 0);
  assert.deepEqual(getMatch(fromDisk), { leftId: burgerIds[4], rightId: burgerIds[0], revision: 0 });
  assert.equal(resumeSession(snapshot, null, null), null);
});

test('actual current-pair replacement pauses/resumes without protocol changes or fake decisions',()=>{
 let arena=choose(createArena(drinkIds,'personal','drink',edges),'right',0,edges);
 arena={...arena,pair:[drinkIds[1],drinkIds[2]],revision:arena.revision+1};
 const restored=resumeSession(snapshot,serializeSession(snapshot,[arena],0),null)!.arenas[0];
 assert.deepEqual(restored.pair,arena.pair);assert.deepEqual(restored.remainingIds,arena.remainingIds);assert.deepEqual(restored.history,arena.history);assert.notEqual(restored.arenaId,arena.arenaId);assert.equal(restored.revision,1);
});
