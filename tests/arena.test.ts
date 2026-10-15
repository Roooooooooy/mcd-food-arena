import test from 'node:test';
import assert from 'node:assert/strict';
import { choose, completedChoices, createArena, drawRandomPair, getMatch, skip, undo } from '../src/arena/engine.ts';

const edges = (ids: readonly string[]): [string, string] => [ids.at(-1)!, ids[0]];

// Catches a winner being forced into the next match, or a loser re-entering the pool.
test('每轮从存活池抽两份，胜者留池，下一轮可以完全不包含上一轮胜者', () => {
  const pairs: [string, string][] = [['b', 'd'], ['a', 'c'], ['d', 'c']];
  const draw = () => pairs.shift()!;
  let state = createArena(['a', 'b', 'c', 'd'], 'run-1', 'burger', draw);
  assert.deepEqual(getMatch(state), { leftId: 'b', rightId: 'd', revision: 0 });
  assert.equal(state.championId, null);
  state = choose(state, 'right', 0, draw);
  assert.deepEqual(state.remainingIds, ['a', 'c', 'd']);
  assert.deepEqual(getMatch(state), { leftId: 'a', rightId: 'c', revision: 1 });
  state = choose(state, 'right', 1, draw);
  assert.deepEqual(state.remainingIds, ['c', 'd']);
  assert.deepEqual(getMatch(state), { leftId: 'd', rightId: 'c', revision: 2 });
  state = choose(state, 'right', 2, draw);
  assert.equal(state.championId, 'c');
  assert.equal(state.status, 'complete');
  assert.deepEqual(state.remainingIds, ['c']);
  assert.equal(state.history.length, 3);
  assert.equal(getMatch(state), null);
});

test('读取同一轮对阵不会重抽，左右不能是同一候选或池外候选', () => {
  let draws = 0;
  const state = createArena(['a', 'b', 'c'], 'run-1', 'burger', ids => { draws++; return edges(ids); });
  for (let i = 0; i < 5; i++) assert.deepEqual(getMatch(state), { leftId: 'c', rightId: 'a', revision: 0 });
  assert.equal(draws, 1);
  for (const pair of [['a', 'a'], ['a', 'gone']] as [string, string][]) {
    assert.throws(() => createArena(['a', 'b'], 'run-1', 'burger', () => pair));
  }
});

for (const ids of [[], ['a'], ['a', 'a']]) {
  test(`${ids.length}项输入只剩零或一份时不抽签，不产生伪比赛`, () => {
    let draws = 0;
    const state = createArena(ids, 'run-empty', 'drink', () => { draws++; throw new Error('must not draw'); });
    assert.equal(state.status, ids.length === 0 ? 'empty' : 'complete');
    assert.equal(state.championId, ids.length === 0 ? null : 'a');
    assert.deepEqual(state.remainingIds, [...new Set(ids)]);
    assert.equal(state.revision, 0);
    assert.deepEqual(state.history, []);
    assert.equal(getMatch(state), null);
    assert.equal(choose(state, 'left', 0), state);
    assert.equal(undo(state), state);
    assert.equal(draws, 0);
  });
}

test('候选去重，原输入与已返回状态不会被后续选择修改', () => {
  const ids = ['b', 'a', 'b', 'c', 'a'];
  const first = createArena(ids, 'run-42', 'breakfast', edges);
  ids.reverse();
  assert.deepEqual(first.orderedIds, ['b', 'a', 'c']);
  assert.equal(first.arenaId, 'run-42');
  assert.equal(first.stageId, 'breakfast');
  const snapshot = structuredClone(first);
  const next = choose(first, 'right', 0, edges);
  assert.notEqual(next, first);
  assert.deepEqual(first, snapshot);
  assert.equal(next.history.length, 1);
  assert.deepEqual(next.history[0].remainingIds, ['b', 'a', 'c']);
});

for (let count = 2; count <= 100; count++) {
  test(`${count}份随机淘汰中，败者不回池，全员参与且恰好${count - 1}次决出唯一冠军`, () => {
    const ids = Array.from({ length: count }, (_, i) => `candidate-${i}`);
    const appeared = new Set<string>();
    const eliminated = new Set<string>();
    let state = createArena(ids, `run-${count}`, 'burger', edges);
    for (let round = 0; round < count - 1; round++) {
      const match = getMatch(state)!;
      assert.ok(match);
      assert.notEqual(match.leftId, match.rightId);
      assert.equal(eliminated.has(match.leftId), false);
      assert.equal(eliminated.has(match.rightId), false);
      appeared.add(match.leftId); appeared.add(match.rightId);
      eliminated.add(match.leftId);
      state = choose(state, 'right', state.revision, edges);
      assert.equal(state.remainingIds.length, count - round - 1);
      assert.ok(state.remainingIds.includes(match.rightId));
      assert.equal(state.remainingIds.includes(match.leftId), false);
    }
    assert.equal(state.status, 'complete');
    assert.equal(state.championId, 'candidate-0');
    assert.equal(state.history.length, count - 1);
    assert.equal(state.revision, count - 1);
    assert.equal(appeared.size, count);
    assert.equal(getMatch(state), null);
    assert.equal(choose(state, 'left', state.revision), state);
  });
}

test('重复提交、无效选边、旧和未来revision均不推进或再抽签', () => {
  const first = createArena(['a', 'b', 'c'], 'run-1', 'burger', edges);
  const next = choose(first, 'right', 0, edges);
  const mustNotDraw = () => { throw new Error('must not redraw'); };
  assert.equal(choose(next, 'left', 0, mustNotDraw), next);
  assert.equal(choose(next, 'right', 0, mustNotDraw), next);
  assert.equal(choose(next, 'left', 2, mustNotDraw), next);
  assert.equal(choose(next, 'unknown' as 'left', 1, mustNotDraw), next);
});

test('撤回恢复原候选池和原对阵，revision递增以拒绝旧硬币回调', () => {
  const initial = createArena(['a', 'b', 'c'], 'run-1', 'burger', edges);
  const next = choose(initial, 'right', 0, edges);
  const nextSnapshot = structuredClone(next);
  const restored = undo(next);
  assert.deepEqual(restored.remainingIds, ['a', 'b', 'c']);
  assert.deepEqual(getMatch(restored), { leftId: 'c', rightId: 'a', revision: 2 });
  assert.equal(restored.championId, null);
  assert.equal(restored.history.length, 0);
  assert.deepEqual(next, nextSnapshot);
  assert.equal(choose(restored, 'right', 0), restored);
  assert.equal(choose(restored, 'right', 1), restored);
  assert.deepEqual(choose(restored, 'left', 2, edges).remainingIds, ['b', 'c']);
});

test('决出冠军后仍能逐次撤回到最初随机对阵', () => {
  const initial = createArena(['a', 'b', 'c'], 'run-1', 'burger', edges);
  const second = choose(initial, 'right', 0, edges);
  const complete = choose(second, 'right', 1, edges);
  assert.equal(complete.championId, 'a');
  const restored = undo(complete);
  assert.deepEqual(getMatch(restored), { leftId: 'b', rightId: 'a', revision: 3 });
  const original = undo(restored);
  assert.deepEqual(getMatch(original), { leftId: 'c', rightId: 'a', revision: 4 });
  assert.equal(undo(original), original);
});

for (const ids of [[], ['a'], ['a', 'b', 'c']]) {
  test(`跳过${ids.length}份候选不产生冠军，撤回仍恢复跳过前池和对阵`, () => {
    const initial = createArena(ids, 'run-1', 'burger', edges);
    const skipped = skip(initial);
    assert.equal(skipped.status, 'skipped');
    assert.equal(skipped.championId, null);
    assert.deepEqual(skipped.remainingIds, initial.remainingIds);
    assert.equal(getMatch(skipped), null);
    assert.equal(skip(skipped), skipped);
    assert.equal(choose(skipped, 'left', skipped.revision), skipped);
    const restored = undo(skipped);
    assert.deepEqual(restored.remainingIds, initial.remainingIds);
    assert.equal(restored.status, initial.status);
    assert.equal(restored.championId, initial.championId);
    const match = getMatch(initial);
    assert.deepEqual(getMatch(restored), match ? { ...match, revision: 2 } : null);
  });
}


test('三份候选的六种有序对阵均可等概率抽到，右侧不会重复左侧', () => {
  const fixtures: [number, number, [string, string]][] = [
    [0, 0, ['a', 'b']], [0, 1, ['a', 'c']],
    [1, 0, ['b', 'a']], [1, 1, ['b', 'c']],
    [2, 0, ['c', 'a']], [2, 1, ['c', 'b']],
  ];
  for (const [left, right, expected] of fixtures) {
    const words = [left, right];
    assert.deepEqual(drawRandomPair(['a', 'b', 'c'], () => words.shift()!), expected);
  }
});

test('抽签拒绝不能均分的随机尾部，避免候选偏重', () => {
  const words = [0xffffffff, 2, 0xffffffff];
  assert.deepEqual(drawRandomPair(['a', 'b', 'c'], () => words.shift()!), ['c', 'b']);
  assert.equal(words.length, 0);
  for (const invalid of [-1, 0x100000000, 0.5, NaN]) {
    assert.throws(() => drawRandomPair(['a', 'b'], () => invalid));
  }
});

test('完成选择数量由淘汰数计算，跳过不加一，撤回会减一', () => {
  const initial = createArena(['a', 'b', 'c'], 'run-1', 'burger', edges);
  const chosen = choose(initial, 'left', 0, edges);
  assert.equal(completedChoices(initial), 0);
  assert.equal(completedChoices(chosen), 1);
  assert.equal(completedChoices(skip(chosen)), 1);
  assert.equal(completedChoices(undo(chosen)), 0);
  assert.equal(completedChoices(choose(chosen, 'right', 1)), 2);
});
