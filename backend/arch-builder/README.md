# arch-builder

The builder does a session's work on the code: it builds a change, takes the
member's replies, merges a branch or abandons one. Each of these is a **run**:
one unit of work the session starts, watches in the chat as it happens, and can
cancel. A run goes through a container that holds the checkout and the coding
agent; this package is the Worker side of it, the image is `apps/builder`.

## Moving parts

```
 BuildSessionObject ──runAgentTool──▶ BuilderRunHandle ──RPC──▶ BuilderObject ──turns──▶ builder container
 (the session)                        (the run's face)            (owns the container)    (apps/builder)
        ▲                                                              │
        └──────────────── relay(text), builderStatus(status) ──────────┘
```

| Part                 | File                     | What it is                                                                                                                                                                       |
| -------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Run**              | `protocol.ts`, `runs.ts` | What to do: the mode (build, continue, merge, abandon), the branch, the credentials, the plan or the message, the files. `runs.ts` makes one.                                    |
| **BuilderRunHandle** | `run-handle.ts`          | The session's agent-tool child for one run. It has no container; it forwards start, inspect, chunks, tail and cancel to the builder.                                             |
| **BuilderObject**    | `builder-object.ts`      | The Durable Object that owns the session's container and runs one run at a time. It keeps the builder's state: what is active, what is parked, what the member said meanwhile.   |
| **Checkpoint**       | `state.ts`               | Where a run is: its phase, turn number, next prompt, outcome so far. Stashed into the run's fiber before every phase, so an evicted object resumes from it.                      |
| **Phases**           | `phases.ts`              | The sequence a run follows, one phase per call: it takes a turn, tells the session what matters, and says whether the run goes on, parks on a question, or ends.                 |
| **Turns**            | `turns.ts`               | One container turn: a step command or a turn of the coding agent, submitted to the harness and waited for. Its events become the run's lines through `event-relay.ts`.           |
| **RunRecords**       | `run-records.ts`         | Each run's record and lines in the object's SQLite (`runs`, `run_chunks`), and the live tail the handle streams to the session.                                                  |
| **Harness**          | `harness.ts`             | The container harness: the image, the instance size, the idle timeout, and the egress that adds the gateway credentials to the coding agent's model calls outside the container. |
| **Session link**     | `session-link.ts`        | What the builder may tell the session: a message for the chat, a status, and a run to start (merges and abandons come from the branch menu this way).                            |

## A run, start to end

1. The session calls `runAgentTool(BuilderRunHandle, { sessionId, run })`. The
   handle calls the builder's `startRun(runId, run)`: the record opens and a
   fiber starts on a fresh checkpoint.
2. The fiber loops: stash the checkpoint, post the phase as the run's status,
   run the phase, read what comes next. A phase takes one turn; the turn's
   events are written as the run's lines, the handle tails them, and the
   session streams them into the chat as the run's chunks.
3. A question from the coding agent parks the run: the checkpoint moves to the
   builder's state as `waiting`, the container is snapshotted and stopped once
   idle. The member's reply arrives through `continueWith` and starts the fiber
   again on the same checkpoint. A message that arrives during a turn waits in
   `pending` for the next agent turn.
4. The run ends in `finish`: the session gets the terminal status, the record
   closes and every tail is let go, and the container is stopped unless the run
   failed, since a fix may follow.

Thirty minutes without a word from the member halts the builder: the turn under
way is aborted, the container stopped, and the run parks instead of failing. A
merge or an abandon cannot park, so it fails and the branch is released.
