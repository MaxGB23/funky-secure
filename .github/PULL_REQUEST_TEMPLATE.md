<!-- Read CONTRIBUTING.md before filling this in. An unchecked box is honest; a falsely checked one is not. -->

## Linked issue

<!-- Required. The issue must carry the `status:approved` label. -->

Closes #

## Type

<!-- Check exactly one, and apply the matching `type:*` label. -->

- [ ] Bug fix — `type:bug`
- [ ] New feature — `type:feature`
- [ ] Documentation only — `type:docs`
- [ ] Code refactoring — `type:refactor`
- [ ] Maintenance or tooling — `type:chore`
- [ ] Breaking change — `type:breaking-change`

## Summary

<!-- One to three bullets: what changed and why. -->

## Changes

| File | Change |
| --- | --- |
| `` |  |

## Test plan

<!-- The commands you actually ran, with their outcome. Never invent a green run. -->

```sh
node --test            # N passing, 0 failing
node --test tests/drift.test.js
node bin/funky-secure.js scan --scope repo --fail-on warn   # exit 0
```

Manual checks, when the change is visible in output or in a written file:

## Risk

<!-- `Risk: items 1-6 (reason)` or `Risk: none`. High risk: stored data, credentials or guards,
     a contract others consume, concurrency, delivery and CI, or no test that would catch a
     regression. Anything high risk gets its own commit and the native review. -->

Risk:

## Contributor checklist

- [ ] The branch is named `type/description`.
- [ ] The linked issue carries `status:approved`, and exactly one `type:*` label is applied here.
- [ ] Every commit is conventional, and the history is reviewable work units (~400 authored lines).
- [ ] Behavior changes are test-first, and the tests assert exit codes, exact output, and that
      rejected input changes nothing.
- [ ] Rule pages, `docs/cli.md`, the help text and `docs/decisions.md` are updated where behavior
      or a message changed.
- [ ] Goldens were regenerated only if the report was meant to change, and the diff was read.
- [ ] `node --test`, the drift gate and the self-scan pass locally.
- [ ] `pnpm pack --dry-run` still ships the expected files, when packaging changed.
- [ ] No dependency was added, and none was needed.
- [ ] No `Co-Authored-By` trailer and no secret in the diff, the fixtures or the output.
