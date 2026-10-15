import test from 'node:test';
import assert from 'node:assert/strict';
import { beginStageDrag, commitStageDrag } from '../src/setup/stage-order.ts';
import type { StageSelection } from '../src/setup/session.ts';

const stages: StageSelection[] = [
  { id: 'burger', candidateIds: ['b1', 'b3'] },
  { id: 'side', candidateIds: ['s2'] },
  { id: 'drink', candidateIds: ['d1', 'd2', 'd4'] },
];

// A missing move, wrong splice index or rebuilding candidates must fail this.
test('向上或向下放置分类，只改变顺序，保留全部勾选及原输入', () => {
  for (const [active, target, expected] of [
    ['drink', 'burger', ['drink', 'burger', 'side']],
    ['burger', 'drink', ['side', 'drink', 'burger']],
  ] as const) {
    const before = structuredClone(stages);
    const result = commitStageDrag(stages, beginStageDrag('menu-a', stages, active), 'menu-a', target);
    assert.deepEqual(result.map(stage => stage.id), expected);
    assert.deepEqual(stages, before);
    for (const original of stages) {
      assert.equal(result.find(stage => stage.id === original.id), original);
      assert.equal(result.find(stage => stage.id === original.id)?.candidateIds, original.candidateIds);
    }
  }
});

test('取消、放到列表外或原位不改变顺序', () => {
  assert.equal(commitStageDrag(stages, null, 'menu-a', 'drink'), stages);
  for (const target of [null, 'gone', 'side']) {
    assert.equal(commitStageDrag(stages, beginStageDrag('menu-a', stages, 'side'), 'menu-a', target), stages);
  }
});

test('拖动后菜单、分类或候选改变，旧拖动不能覆盖新选择', () => {
  const drag = beginStageDrag('menu-a', stages, 'burger');
  assert.ok(drag);
  const updated = [stages[0], stages[1], { ...stages[2], candidateIds: ['d4'] }];
  assert.equal(commitStageDrag(updated, drag, 'menu-a', 'drink'), updated);
  assert.equal(commitStageDrag(stages, drag, 'menu-b', 'drink'), stages);
  const reordered = [stages[2], stages[0], stages[1]];
  assert.equal(commitStageDrag(reordered, drag, 'menu-a', 'drink'), reordered);
});

test('单分类、未知分类和重复分类不产生可提交的拖动', () => {
  assert.equal(beginStageDrag('menu-a', [stages[0]], 'burger'), null);
  assert.equal(beginStageDrag('menu-a', stages, 'gone'), null);
  assert.equal(beginStageDrag('menu-a', [stages[0], stages[0]], 'burger'), null);
});
