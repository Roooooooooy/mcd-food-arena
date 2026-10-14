import test from 'node:test';
import assert from 'node:assert/strict';
import { coinTimeline, sideFromByte, lockMatchesArena } from '../src/arena/coin-timing.ts';
import { createArena, choose, undo } from '../src/arena/engine.ts';

test('all 256 bytes give exactly 128 left and 128 right results', () => {
  const sides = Array.from({ length: 256 }, (_, i) => sideFromByte(i));
  assert.equal(sides.filter(side => side === 'left').length, 128);
  assert.equal(sides.filter(side => side === 'right').length, 128);
  assert.equal(sideFromByte(0), 'left');
  assert.equal(sideFromByte(255), 'right');
});

test('coin highlights alternate, slow down and end on either sealed side', () => {
  for (const target of ['left', 'right'] as const) {
    const stops = coinTimeline(target);
    assert.equal(stops.at(-1)?.side, target);
    assert.ok(stops.every((stop, i) => i === 0 || stop.side !== stops[i - 1].side));
    const gaps = stops.slice(1).map((stop, i) => stop.atMs - stops[i].atMs);
    assert.ok(gaps.every((gap, i) => gap > 0 && (i === 0 || gap >= gaps[i - 1])));
    assert.ok(stops.at(-1)!.atMs >= 1400 && stops.at(-1)!.atMs <= 2000);
  }
});

test('a sealed result cannot submit after a new arena, choice or undo', () => {
  const arena = createArena(['a', 'b', 'c'], 'round-1', 'burger');
  const lock = { arenaId: arena.arenaId, revision: arena.revision, finalSide: 'right' as const };
  assert.equal(lockMatchesArena(lock, arena), true);
  assert.equal(lockMatchesArena(lock, createArena(['a', 'b', 'c'], 'round-2', 'burger')), false);
  const next = choose(arena, 'left', 0);
  assert.equal(lockMatchesArena(lock, next), false);
  assert.equal(lockMatchesArena(lock, undo(next)), false);
  assert.equal(lockMatchesArena(lock, createArena(['a'], 'round-1', 'burger')), false);
});
