# RFC 0006 — Human defaults

| | |
|---|---|
| **Status** | `accepted` — the owner's objection to a surface made of flags, implemented on branch `feat/start`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.4 and the `explain` section of [`docs/cli.md`](../../docs/cli.md). |
| **Supersedes** | nothing. It changes one default in 11.4 without replacing the command. |
| **Superseded by** | nothing. |

> **How to read this file.** It records why the default path of this CLI is the human path, the one
> command that demanded a flag for its own obvious answer, and the rule that follows from the two.

## Context

The objection was that everything is a flag, and flags are for agents. That is right about the surface
and it names a real failure: a product whose every answer is behind a flag answers only the reader who
already knows which flag to type, and the human meeting the tool for the first time is that reader's
opposite. The cost is paid exactly once, at the moment the tool is supposed to be easiest.

The flags this product already had are not the same kind of thing, and it is worth separating them
before deciding anything:

- **Machine contracts.** `--format json`, `--fail-on`, `--scope`, `--only`, `--ignore`,
  `--strict-probes`, `--with-timestamp`, `--verbose`. Each changes the document or the selection for a
  consumer that asked for it, and each has a default that answers the human question.
- **The gate on a write.** `--apply` for `init` and `migrate`, and `--install` for the one write
  outside the repository (0005, 11.5 point 7). Those are the places where the tool will not act on its
  own, because a write is the one thing a human may not want.
- **The gate on a read.** `explain --list`. This is the one that did not belong. The catalog is the
  most human answer the product has, it destroys nothing, and the only way to reach it was the flag
  that exists to address a machine.

## Decision

The default path is the human path, and it already was. `funky-secure` with no command prints the help.
`start`, `scan`, `init`, `migrate`, `explain` and `skill` each run their ordinary answer with no flag,
in the state a repository is actually in:

| Verb | Flag the ordinary path needs | What it prints with no flag |
|---|---|---|
| `funky-secure` | none | the help |
| `start` | none | the ordered steps for this repository |
| `scan` | none | the policy run over the repository, as the human report |
| `init` | none | the write plan, and the fact that nothing was written |
| `migrate` | none | the removal plan, and the fact that nothing was removed |
| `explain` | none | the catalog, or one rule when given an id |
| `skill` | none | the shipped skill file, byte for byte |

Two flags turn a plan into an action, and both are named in the synopsis: `--apply` for the repository
write of `init` and `migrate`, and `--install` for the one file outside the repository (0005). One
prompt exists in the whole product, and it is in `skill --install`, before replacing an installed copy
— the one step that can discard a local edit. Everywhere else a refusal is exit `2` with the action
first and the reason after it: the tool says no, it does not ask.

### The one behaviour this decides

`funky-secure explain` with no rule id prints the catalog and exits `0`. A missing argument is not a
mistake to punish: a human who types the command alone is asking what there is to explain, and that is
a question the catalog can answer without reading the repository.

`--list` stays, and prints the same bytes. It remains the explicit synonym for scripts and agents that
want a guarantee in the text itself rather than a default, and keeping it costs one condition, because
both routes render the same function. `--format json` means the same thing on both routes, so the two
documents are identical as well.

Everything else about the command is unchanged: one rule id still explains that rule in depth, an
unknown id is exit `2` with the id in the reason, two ids is a usage error, and `--list` together with
a rule id is a usage error.

### The principle

Defaults are human, flags are refinements or machine contracts, and a flag is never the requirement for
the ordinary path. A new command that cannot answer its own question without one is a defect to argue
for in a record, not a default to accept in review.

## Alternatives rejected

- **A TUI.** It is a second rendering of every command: the same plan, the same findings, the same
  question, with its own width, its own keys, its own tests and its own screenshot of truth. Two
  contracts to keep in step, and the one a CI gate reads would be the copy that rots. The deterministic
  text is also the thing an agent parses, so a TUI would be a second surface for the same answers, kept
  for a reader who can already read the first one.
- **A wizard that walks the first run.** It asks for answers the repository already holds — whether
  this is a repository, whether there is a manifest, whether there is a lockfile — and `start` already
  derives those from facts the collector resolved (11.7). It also has to handle every branch of every
  answer, which is the flow `start` prints in six numbered lines.
- **Removing the flags instead.** The flags are not the defect. `--apply` is the reason the tool can be
  trusted with a write, and `--format json` is the contract CI reads; the defect was a flag in front of
  a read.
- **Asking when a command has no argument.** `funky-secure scan` on a terminal would have to ask which
  scope and which preset before it could report anything. A command whose output depends on a
  conversation cannot be scripted, quoted in a review, or compared with the previous run.
- **A `--defaults` or `--no-flags` mode.** A flag that turns flags off, and a second path that has to
  be kept equal to the first at every change.

## Consequences

- One behaviour changed: bare `explain` prints the catalog and exits `0`. `--list` is kept and prints
  the same bytes, so every script and every sentence that already names it keeps working unchanged.
- 11.4 gains one sentence, and the `explain` section of `docs/cli.md` states the same rule with a real
  capture and a synopsis that reads `explain [<rule-id>]`.
- The `--help` summary line for `explain` in `src/cli.js` still reads "or list the catalog with
  `--list`". It is now a refinement described as the only route. Rewording it is a source change with
  its own review, and it is the one place this record leaves out of step.
- The principle has a cost that is deliberately paid in review: a future command whose ordinary path
  needs a flag has to be argued for against this record, not waved through as a flag among flags.
- The prompt stays exactly where it is, one question, in `skill --install`. This record adds no second
  one: interactivity is the answer for a destructive decision, never for a missing default.

## Acceptance

- `funky-secure explain` with no argument prints the catalog on stdout, writes nothing to stderr, and
  exits `0`.
- Those bytes are identical to `funky-secure explain --list`, and the JSON documents of the two routes
  are identical as well.
- `funky-secure explain <rule-id>` still prints one rule; an unknown id, two ids, and `--list` with a
  rule id are still usage errors with the action first and the reason labelled.
- No verb needs a flag to answer its own question, and the only flags that turn a plan into an action
  are `--apply` (`init`, `migrate`) and `--install` (`skill`).
- `tests/cli.test.js` asserts the bare form, its exit code, its empty stderr and its byte equality with
  `--list`.
