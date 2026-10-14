import test from 'node:test';
import assert from 'node:assert/strict';
import { choose, createArena, getMatch, skip, undo } from '../src/arena/engine.ts';

test('胜者守擂，每轮只面对下一位候选，四个候选恰好比较三次', () => {
  let state = createArena(['a', 'b', 'c', 'd'], 'run-1', 'burger');
  assert.deepEqual(getMatch(state), { leftId: 'a', rightId: 'b', revision: 0 });
  state = choose(state, 'right', 0);
  assert.deepEqual(getMatch(state), { leftId: 'b', rightId: 'c', revision: 1 });
  state = choose(state, 'left', 1);
  assert.deepEqual(getMatch(state), { leftId: 'b', rightId: 'd', revision: 2 });
  state = choose(state, 'right', 2);
  assert.equal(state.championId, 'd');
  assert.equal(state.status, 'complete');
  assert.equal(state.history.length, 3);
  assert.equal(getMatch(state), null);
});

test('零候选为 empty，无冠军，无比赛，无需比较', () => {
  const state = createArena([], 'run-empty', 'drink');
  assert.equal(state.status, 'empty');
  assert.equal(state.championId, null);
  assert.equal(state.challengerIndex, 0);
  assert.equal(state.revision, 0);
  assert.deepEqual(state.history, []);
  assert.equal(getMatch(state), null);
  assert.equal(choose(state, 'left', 0), state);
});

test('单个候选直接成为冠军，无需比较', () => {
  const state = createArena(['a'], 'run-single', 'coffee');
  assert.equal(state.championId, 'a');
  assert.equal(state.challengerIndex, 1);
  assert.equal(state.status, 'complete');
  assert.deepEqual(state.history, []);
  assert.equal(getMatch(state), null);
});

test('重复身份只出场一次，保留第一次出现的顺序', () => {
  const state = createArena(['b', 'a', 'b', 'c', 'a', 'c'], 'run-1', 'burger');
  assert.deepEqual(state.orderedIds, ['b', 'a', 'c']);
  assert.deepEqual(getMatch(state), { leftId: 'b', rightId: 'a', revision: 0 });
  const second = choose(state, 'right', 0);
  assert.deepEqual(getMatch(second), { leftId: 'a', rightId: 'c', revision: 1 });
  const complete = choose(second, 'left', 1);
  assert.equal(complete.history.length, 2);
  assert.equal(complete.status, 'complete');
});

test('所有输入身份相同只产生一个直接冠军', () => {
  const state = createArena(['a', 'a', 'a'], 'run-1', 'burger');
  assert.deepEqual(state.orderedIds, ['a']);
  assert.equal(state.championId, 'a');
  assert.equal(state.status, 'complete');
  assert.equal(getMatch(state), null);
});

test('创建不保留调用方的候选数组引用，且携带擂台与赛区身份', () => {
  const ids = ['a', 'b', 'c'];
  const state = createArena(ids, 'run-42', 'breakfast');
  ids.reverse();
  assert.deepEqual(state.orderedIds, ['a', 'b', 'c']);
  assert.equal(state.arenaId, 'run-42');
  assert.equal(state.stageId, 'breakfast');
});

for (let count = 2; count <= 100; count += 1) {
  test(`${count} 个候选全部出场，恰好 ${count - 1} 次选择后完成`, () => {
    const ids = Array.from({ length: count }, (_, index) => `candidate-${index}`);
    let state = createArena(ids, `run-${count}`, 'burger');
    for (let challenger = 1; challenger < count; challenger += 1) {
      assert.deepEqual(getMatch(state), {
        leftId: 'candidate-0',
        rightId: `candidate-${challenger}`,
        revision: challenger - 1,
      });
      state = choose(state, 'left', state.revision);
    }
    assert.equal(state.status, 'complete');
    assert.equal(state.championId, 'candidate-0');
    assert.equal(state.history.length, count - 1);
    assert.equal(state.revision, count - 1);
    assert.equal(getMatch(state), null);
  });
}

test('一直选右，上一轮右侧冠军在下一轮出现在左侧，末位成为冠军', () => {
  let state = createArena(['a', 'b', 'c', 'd', 'e'], 'run-1', 'burger');
  for (const [index, champion] of ['b', 'c', 'd', 'e'].entries()) {
    state = choose(state, 'right', state.revision);
    assert.equal(state.championId, champion);
    assert.equal(state.history.length, index + 1);
  }
  assert.equal(state.status, 'complete');
  assert.equal(state.championId, 'e');
});

test('重复提交、旧 revision 和未来 revision 都不推进下一轮', () => {
  const first = createArena(['a', 'b', 'c'], 'run-1', 'burger');
  const next = choose(first, 'right', 0);
  assert.deepEqual(getMatch(next), { leftId: 'b', rightId: 'c', revision: 1 });
  assert.equal(choose(next, 'left', 0), next);
  assert.equal(choose(next, 'right', 0), next);
  assert.equal(choose(next, 'left', 2), next);
});

test('选择返回新状态，不修改上一轮状态或历史', () => {
  const first = createArena(['a', 'b', 'c'], 'run-1', 'burger');
  const snapshot = structuredClone(first);
  const next = choose(first, 'right', 0);
  assert.notEqual(next, first);
  assert.deepEqual(first, snapshot);
  assert.deepEqual(next.history, [{ championId: 'a', challengerIndex: 1, status: 'active' }]);
});

test('上一步恢复餐品但 revision 继续递增，旧回调拒绝', () => {
  const first = createArena(['a', 'b', 'c'], 'run-1', 'burger');
  const advanced = choose(first, 'right', 0);
  const restored = undo(advanced);
  assert.equal(restored.championId, 'a');
  assert.equal(restored.challengerIndex, 1);
  assert.equal(restored.revision, 2);
  assert.equal(restored.history.length, 0);
  assert.deepEqual(getMatch(restored), { leftId: 'a', rightId: 'b', revision: 2 });
  assert.equal(choose(restored, 'right', 0), restored);
  assert.equal(choose(restored, 'right', 1), restored);
  assert.equal(choose(restored, 'right', 2).championId, 'b');
});

test('完成后可以连续撤回到起始比赛，revision 始终递增', () => {
  const first = createArena(['a', 'b', 'c'], 'run-1', 'burger');
  const second = choose(first, 'right', 0);
  const complete = choose(second, 'right', 1);
  const restored = undo(complete);
  assert.deepEqual(getMatch(restored), { leftId: 'b', rightId: 'c', revision: 3 });
  const originalMatch = undo(restored);
  assert.deepEqual(getMatch(originalMatch), { leftId: 'a', rightId: 'b', revision: 4 });
  assert.equal(undo(originalMatch), originalMatch);
  assert.equal(choose(complete, 'left', complete.revision), complete);
});

test('撤回不修改原状态和原历史', () => {
  const advanced = choose(createArena(['a', 'b'], 'run-1', 'burger'), 'right', 0);
  const snapshot = structuredClone(advanced);
  const restored = undo(advanced);
  assert.notEqual(restored, advanced);
  assert.deepEqual(advanced, snapshot);
  assert.equal(restored.status, 'active');
});

test('没有历史时撤回为无操作，空赛区和直接冠军也不产生伪比赛', () => {
  for (const ids of [[], ['a'], ['a', 'b']]) {
    const state = createArena(ids, 'run-1', 'burger');
    assert.equal(undo(state), state);
  }
});

test('跳过清空冠军并停止比赛，重复跳过与选择为无操作', () => {
  const active = choose(createArena(['a', 'b', 'c'], 'run-1', 'burger'), 'right', 0);
  const skipped = skip(active);
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.championId, null);
  assert.equal(skipped.revision, 2);
  assert.equal(getMatch(skipped), null);
  assert.equal(skip(skipped), skipped);
  assert.equal(choose(skipped, 'left', skipped.revision), skipped);
  assert.equal(active.championId, 'b');
  assert.equal(active.status, 'active');
});

test('跳过可撤回到原比赛，旧回调仍被拒绝', () => {
  const first = createArena(['a', 'b', 'c'], 'run-1', 'burger');
  const restored = undo(skip(first));
  assert.deepEqual(getMatch(restored), { leftId: 'a', rightId: 'b', revision: 2 });
  assert.equal(restored.history.length, 0);
  assert.equal(choose(restored, 'right', 0), restored);
});

test('空赛区和直接冠军均可跳过，结果无冠军', () => {
  for (const ids of [[], ['a']]) {
    const state = createArena(ids, 'run-1', 'burger');
    const skipped = skip(state);
    assert.equal(skipped.championId, null);
    assert.equal(skipped.status, 'skipped');
    assert.equal(skipped.revision, 1);
    assert.equal(getMatch(skipped), null);
  }
});
