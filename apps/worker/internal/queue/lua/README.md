# Vendored BullMQ Lua scripts

Third-party code, generated. Do not hand-edit anything in this directory.

Source: [BullMQ](https://github.com/taskforcesh/bullmq) `5.81.4`, from
`node_modules/bullmq/dist/cjs/scripts`. Licensed MIT — see `LICENSE.bullmq`.

## Why these are vendored

The producer in `apps/web` is BullMQ on Node; this worker is Go. The queue
state BullMQ maintains is not a simple list: it spans the wait list, the active
list, a marker key, an events stream, the stalled set, the prioritized set,
lock keys, and per-job hashes, and the transitions between them are performed
atomically by these scripts.

`EXECUTION.md` is explicit that the worker must not invent a parallel protocol,
because the backend has to be able to inspect these queues with BullMQ tooling.
Re-implementing the transitions in Go would mean guessing at that state machine,
and a subtly wrong guess does not fail loudly — it hands the same submission to
two workers, or strands a job in `active` forever. Running the exact scripts the
producer's own library runs removes that entire class of bug.

## What is here

| Script                          | Used for                             |
| ------------------------------- | ------------------------------------ |
| `moveToActive-11.lua`           | claim the next job and lock it       |
| `moveToFinished-14.lua`         | report a job completed or failed     |
| `moveJobFromActiveToWait-9.lua` | return an unfinished job on shutdown |

The `-N` suffix is the number of KEYS the script expects, taken from BullMQ's
own declaration rather than counted by hand. `loader.go` parses it back out, so
there is one source for that number.

These come from BullMQ's `dist/cjs/scripts`, which is the build it has already
flattened, **not** `dist/cjs/commands`, which still carries unresolved
`--- @include` directives. The distinction matters: the fragments close over
`local rcall = redis.call` from the parent body, so they must be spliced in
where the directives sat rather than hoisted above it. Resolving the includes
independently means reproducing that rule exactly, and getting it wrong
produces Lua that fails only once Redis runs it —
`Script attempted to access nonexistent global variable 'rcall'`.

## Re-vendoring after a BullMQ upgrade

The scripts are pinned to one BullMQ version on purpose — the KEYS/ARGV layout
changes between releases. When `bullmq` is upgraded in `package.json`, re-run:

```bash
node scripts/revendor-bullmq-lua.mjs
```

then update the version named above, run `go test ./internal/queue/...`, and fix
any KEYS/ARGV drift the tests surface. Never upgrade `bullmq` without doing this
in the same commit.
