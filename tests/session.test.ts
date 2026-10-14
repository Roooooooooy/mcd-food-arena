import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog } from '../src/demo/menu.ts';
import { choose, getMatch, skip, undo } from '../src/arena/engine.ts';
import { startSession, serializeSession, restoreSession, resumeSession } from '../src/setup/session.ts';

const snapshot = demoCatalog();
const burgerIds = snapshot.items.filter(item => item.stageId === 'burger').map(item => item.id);
const drinkIds = snapshot.items.filter(item => item.stageId === 'drink').map(item => item.id);

test('selected stage order and all five selected candidates survive the full session', () => {
  const arenas = startSession(snapshot, [{ id: 'drink', candidateIds: drinkIds }, { id: 'burger', candidateIds: burgerIds }]);
  assert.deepEqual(arenas.map(arena => arena.stageId), ['drink', 'burger']);
  assert.deepEqual(arenas[0].orderedIds, drinkIds);
  let arena = arenas[0];
  const appeared = new Set([getMatch(arena)!.leftId]);
  while (getMatch(arena)) {
    appeared.add(getMatch(arena)!.rightId);
    arena = choose(arena, 'right', arena.revision);
  }
  assert.equal(arena.history.length, 4);
  assert.equal(arena.championId, 'demo:drink:lychee-tea');
  assert.equal(appeared.size, 5);
  assert.notEqual(startSession(snapshot, [{ id: 'drink', candidateIds: drinkIds }])[0].arenaId, arenas[0].arenaId);
});

test('empty, missing, cross-category and repeated stages cannot start', () => {
  for (const stages of [[], [{ id: 'burger', candidateIds: [] }], [{ id: 'burger', candidateIds: ['gone'] }], [{ id: 'burger', candidateIds: drinkIds }], [{ id: 'burger', candidateIds: burgerIds }, { id: 'burger', candidateIds: burgerIds }]]) {
    assert.throws(() => startSession(snapshot, stages));
  }
});

test('restore replays choices and skips, retains selected order, and makes a new identity', () => {
  const arenas = startSession(snapshot, [{ id: 'drink', candidateIds: drinkIds }, { id: 'burger', candidateIds: burgerIds }]);
  arenas[0] = choose(choose(arenas[0], 'right', 0), 'left', 1);
  arenas[1] = skip(arenas[1]);
  const saved = serializeSession(snapshot, arenas, 0);
  const restored = restoreSession(snapshot, saved);
  assert.equal(restored.arenas[0].championId, 'demo:drink:zero-soda');
  assert.equal(getMatch(restored.arenas[0])!.rightId, 'demo:drink:orange-drink');
  assert.equal(restored.arenas[0].history.length, 2);
  assert.equal(restored.arenas[1].status, 'skipped');
  assert.equal(restored.activeStageIndex, 0);
  assert.notEqual(restored.arenas[0].arenaId, arenas[0].arenaId);
  assert.equal(saved.includes('arenaId'), false);
  assert.equal(saved.includes('name'), false);
  assert.equal(saved.includes('referencePrice'), false);
});

test('undo discards revoked decisions before persistence and restore', () => {
  const [initial] = startSession(snapshot, [{ id: 'burger', candidateIds: burgerIds }]);
  const undone = undo(choose(choose(initial, 'right', 0), 'right', 1));
  const { arenas } = restoreSession(snapshot, serializeSession(snapshot, [undone], 0));
  assert.equal(arenas[0].championId, 'demo:burger:pepper-chicken');
  assert.equal(getMatch(arenas[0])!.rightId, 'demo:burger:double-beef');
  assert.equal(arenas[0].history.length, 1);
});

test('changed context, removed candidates and corrupted saved decisions require restart', () => {
  const arenas = startSession(snapshot, [{ id: 'burger', candidateIds: burgerIds }]);
  const saved = serializeSession(snapshot, arenas, 0);
  assert.throws(() => restoreSession({ ...snapshot, contextKey: 'different-menu' }, saved));
  assert.throws(() => restoreSession({ ...snapshot, items: snapshot.items.slice(1) }, saved));
  const malformed = JSON.parse(saved);
  malformed.stages[0].decisions = ['right', 'right', 'right', 'right', 'right'];
  assert.throws(() => restoreSession(snapshot, JSON.stringify(malformed)));
  malformed.stages[0].decisions = ['unknown'];
  assert.throws(() => restoreSession(snapshot, JSON.stringify(malformed)));
  assert.throws(() => restoreSession(snapshot, '{'));
  assert.throws(() => restoreSession(snapshot, 'null'));
});

test('continue uses the latest in-memory pause when readable storage still holds an older session', () => {
  const [initial] = startSession(snapshot, [{ id: 'burger', candidateIds: burgerIds }]);
  const olderPersisted = serializeSession(snapshot, [initial], 0);
  const pausedArena = choose(initial, 'right', initial.revision);
  // This record remains in memory if writing the pause to storage is denied.
  const latestPaused = serializeSession(snapshot, [pausedArena], 0);
  const restored = resumeSession(snapshot, latestPaused, olderPersisted)!;

  assert.equal(restored.arenas[0].history.length, 1);
  assert.equal(restored.arenas[0].championId, 'demo:burger:pepper-chicken');
  assert.equal(getMatch(restored.arenas[0])!.rightId, 'demo:burger:double-beef');
  assert.notEqual(restored.arenas[0].arenaId, pausedArena.arenaId);
  const continued = choose(restored.arenas[0], 'left', restored.arenas[0].revision);
  assert.equal(continued.history.length, 2);
  assert.equal(continued.championId, 'demo:burger:pepper-chicken');
  assert.equal(getMatch(continued)!.rightId, 'demo:burger:mushroom-cheese');

  const fromDisk = resumeSession(snapshot, null, olderPersisted)!;
  assert.equal(fromDisk.arenas[0].history.length, 0);
  assert.equal(fromDisk.arenas[0].championId, 'demo:burger:cheese-beef');
  assert.equal(resumeSession(snapshot, null, null), null);
});
