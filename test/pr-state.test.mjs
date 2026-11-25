import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluatePr, summariseChecks } from '../lib/pr-state.mjs';

const HEAD = 'a'.repeat(40);
const profile = {
  pr: {
    reviewers: [
      { name: 'Reviewer bot', login: 'review-bot' },
      { name: 'Checker', checkName: 'PR checker' },
    ],
  },
};
const check = (name, status, conclusion) => ({ __typename: 'CheckRun', name, status, conclusion });
const pr = (over = {}) => ({
  state: 'OPEN',
  isDraft: true,
  headRefOid: HEAD,
  mergeable: 'MERGEABLE',
  labels: [],
  reviews: [],
  statusCheckRollup: [check('Build', 'COMPLETED', 'SUCCESS')],
  ...over,
});

test('checks summary', () => {
  assert.deepEqual(summariseChecks([check('a', 'COMPLETED', 'SUCCESS'), check('b', 'IN_PROGRESS', null)]), { finished: false, failed: [] });
  assert.deepEqual(summariseChecks([check('a', 'COMPLETED', 'FAILURE'), { __typename: 'StatusContext', context: 'c', state: 'ERROR' }]), {
    finished: true,
    failed: ['a', 'c'],
  });
});

test('draft with CI running needs nothing', () => {
  const e = evaluatePr(pr({ statusCheckRollup: [check('Build', 'IN_PROGRESS', null)] }), { status: 'pr_draft' }, profile);
  assert.equal(e.reason, null);
});

test('draft: CI failed, then passed', () => {
  assert.equal(evaluatePr(pr({ statusCheckRollup: [check('Build', 'COMPLETED', 'FAILURE')] }), { status: 'pr_draft' }, profile).reason, 'ci_failed');
  assert.equal(evaluatePr(pr(), { status: 'pr_draft' }, profile).reason, 'ci_passed');
});

test('ready: waits for every reviewer on the head commit', () => {
  const ready = { isDraft: false };
  const e1 = evaluatePr(pr(ready), { status: 'pr_draft' }, profile);
  assert.equal(e1.status, 'pr_ready');
  assert.equal(e1.reason, null);

  const oldReview = { author: { login: 'review-bot' }, commit: { oid: 'b'.repeat(40) } };
  assert.equal(evaluatePr(pr({ ...ready, reviews: [oldReview] }), { status: 'pr_ready' }, profile).reason, null);

  const both = {
    ...ready,
    reviews: [{ author: { login: 'review-bot' }, commit: { oid: HEAD } }],
    statusCheckRollup: [check('Build', 'COMPLETED', 'SUCCESS'), check('PR checker', 'COMPLETED', 'SUCCESS')],
  };
  const e2 = evaluatePr(pr(both), { status: 'pr_ready' }, profile);
  assert.equal(e2.reason, 'reviews_ready');
  assert.deepEqual(e2.reviewers.reported, ['Reviewer bot', 'Checker']);
});

test('signature changes when a blocking label goes away', () => {
  const base = {
    isDraft: false,
    reviews: [{ author: { login: 'review-bot' }, commit: { oid: HEAD } }],
    statusCheckRollup: [check('PR checker', 'COMPLETED', 'SUCCESS')],
  };
  const a = evaluatePr(pr({ ...base, labels: [{ name: 'needs-audit' }] }), { status: 'pr_ready' }, profile);
  const b = evaluatePr(pr(base), { status: 'pr_ready' }, profile);
  assert.notEqual(a.signature, b.signature);
  assert.equal(evaluatePr(pr(base), { status: 'pr_ready' }, profile).signature, b.signature);
});

test('merged PR is reported', () => {
  assert.equal(evaluatePr(pr({ state: 'MERGED' }), { status: 'pr_ready' }, profile).reason, 'pr_merged');
});
