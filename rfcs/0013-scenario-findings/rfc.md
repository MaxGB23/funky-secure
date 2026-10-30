# RFC 0013 — what the scenarios found

| | |
|---|---|
| **Status** | `implemented` — two corrections inside decisions already taken, `0.7.2`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §10.4, §11.5, §11.9. |
| **Supersedes** | nothing. Both are the code failing to obey 0008 and 0011. |

Three scenarios were run against `0.7.1` outside the repository: a migration from npm with two
lockfiles and an ignored `pnpm-lock.yaml`, three installed skill copies that differ by version and by
bytes, and a repository that already ignores `.npmrc`. Most of the tool behaved. Two places did not,
and both are the same species: **a code that names the wrong thing**.

## The refusal that called itself a failure

`skill --install` over an installed copy that differs has three reachable states, and they answered with
two different exit codes:

| State | Message | Exit |
|---|---|---|
| same version, different bytes | `cannot ask whether to replace …: carries local changes on version 0.7.2 and stdin is not a terminal` | **2** |
| an older copy | `cannot ask whether to replace …: is version 0.5.0; this binary ships 0.7.2 and stdin is not a terminal` | **2** |
| a newer copy | `refusing to replace …: it is version 9.0.0, and this binary ships 0.7.2` | **3** |

0008 drew the line: `2` is "could not answer", `3` is "understood, refused, wrote nothing, and here is
the action". The first two states are understood — the tool names the file, the difference and the
version — and both print the action that lifts them (`--force` or `--keep`). What they could not get was
a keystroke, and in an agent or in CI that keystroke never arrives, so `2` was permanent: an integration
reading it retries or hunts for a flag when the answer is one of two documented words.

The cause was one line: `src/commands/skill.js` threw a plain `Error` carrying `action` where the newer
copy threw `RefusalError`. The no-terminal branch now refuses like its neighbours.

## The summary that counted the wrong thing

`pin` prints a plan and a summary. Its second run over an already-pinned manifest printed:

```
nothing to apply
summary  0 writes · 0 already at policy · 0 conflicts
```

Four specifiers were already exact. The summary counts **files**, and with no item to show there was no
file to count, so both halves of the sentence said zero — which reads as "nothing here was inspected",
the opposite of what happened.

A plan with nothing to write is still a plan. `pin` now emits the manifest as an `would-skip` item with
the reason, so the same run prints:

```
would not write
  …/package.json
    keep exact versions   (4 specifiers are already exact)

summary  0 writes · 1 already at policy · 0 conflicts
```

That also replaces the bare `nothing to apply` on this path: the file, the reason and the count say more
than the absence of a message.

## What it costs

One `throw` that changes class, one counter threaded from `collectPins` to the plan, and two tests whose
expectations moved from the wrong code to the right one. No new command, no new flag, no new file format.

## Verification

- The three no-terminal `skill --install` refusals exit `3`, name the action, and leave the installed
  file byte-identical.
- A `pin` run over an already-pinned manifest names the file, says how many specifiers are already
  exact, and summarises one file at policy with zero writes.
- A second `--apply` still performs zero writes.
- The full suite and the self-scan are green.

## Known friction, deliberately not fixed

Every printed route says `funky-secure <command>`, so a reader who has not installed the package — an
agent given only a path, a scenario harness — must translate each one. The tool cannot know how it was
invoked in a way that would be right for every install channel, and a wrong guess would be worse than
the honest convention. Recorded here so the next reader knows it was seen, not missed.
