import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateReward,
  calculateScore,
  getStreakMultiplier,
} from './5dice.ts';

test('calculates every Five Dice combination', () => {
  const cases: Array<[number[], string, number]> = [
    [[1, 1, 1, 1, 1], 'Five of a Kind', 1500],
    [[1, 1, 1, 1, 2], 'Four of a Kind', 800],
    [[1, 1, 1, 2, 2], 'Full House', 500],
    [[1, 1, 1, 2, 3], 'Three of a Kind', 300],
    [[1, 1, 2, 2, 3], 'Two Pairs', 200],
    [[1, 1, 2, 3, 4], 'One Pair', 100],
    [[1, 2, 3, 4, 5], 'No Match', 0],
  ];
  for (const [dice, type, reward] of cases) {
    const result = calculateScore(dice);
    assert.equal(result.type, type);
    assert.equal(result.baseReward, reward);
  }
});

test('applies score, Lucky Roll, streak, and Daily multipliers once', () => {
  const result = calculateScore([6, 6, 6, 6, 6]);
  assert.equal(
    calculateReward(result, { score: 2, lucky: 1.5, streak: 1.25, daily: 2 }),
    11250,
  );
});

test('uses the capped streak multiplier and resets losing streaks at the caller', () => {
  assert.equal(getStreakMultiplier(1), 1);
  assert.equal(getStreakMultiplier(2), 1.05);
  assert.equal(getStreakMultiplier(5), 1.25);
  assert.equal(getStreakMultiplier(99), 1.25);
});

test('rejects malformed dice state', () => {
  assert.throws(() => calculateScore([1, 2, 3]), /Invalid dice state/);
  assert.throws(() => calculateScore([1, 2, 3, 4, 7]), /Invalid dice state/);
});
