# Yantrix MVP: project-first orchestration

Status: agreed product direction, not implemented. Start the next coding task only
after [PR 6](https://github.com/dhruv-pithadia/yantrix/pull/6) is confirmed merged
into `main`. This document is the handoff for that next task.

## Product goal

Open a project, describe what you want, and let Yantrix organize the work.
The user manages projects, feature outcomes, priorities, and review decisions.
Yantrix manages feature intake, worker conversations, worktrees, branches,
dependencies, execution, context, and recovery.

Users should not have to create a task through a form, link it to a chat, choose
a worktree, or remember which worker conversation owns a feature. Advanced manual
controls remain available, but they are optional.

The left sidebar lists projects. Opening a project opens its ongoing coordinator
conversation and shows active features and items needing attention. Worker chats
remain accessible as details and history. The inbox idea remains useful for review
and decisions, rather than requiring the user to settle every internal session.

## Foundation provided by PR 6

Existing work provides persistent feature tasks, task-owned worktrees, linked
conversations, delivery facts, and explicit prerequisites. PR 6 verifies that
prerequisite PRs were merged into the GitHub origin's default branch before
dependent work starts. Existing work is preserved when integration is required.

PR 6 does **not** infer dependencies, route project chat requests, or automatically
schedule workers. Its calculator experiment demonstrated the explicit dependency
path. Final visual verification remains outstanding at this handoff; this
document does not replace PR review or those checks. See
[the progress ledger](YANTRIX_PROGRESS.md) for delivery evidence.

## Next feature after PR 6: a project coordinator that executes work

Build one complete path from a natural-language project request to a running
feature worker. A sidebar redesign alone is not sufficient.

- Open the project and type a request in its coordinator conversation.
- Resolve whether it is discussion, an investigation, a new feature, or a
  follow-up to existing work. Inspect project state and relevant code rather than
  relying only on wording. Do not create a feature for every message.
- For clear new coding work, create the feature, prepare its isolated worktree
  and branch, and launch a worker through one validated existing provider adapter.
- For a clear follow-up, reuse the feature's workspace and supply its relevant
  context. Ask a focused question only when ambiguity materially changes the work.
- Show what Yantrix understood, what it started, and where progress can be viewed.
  Preparation, execution, waiting, and failure states must reflect actual events.
- Persist the request, routing decision, feature identity, execution state, and
  task handoff. Retrying or reconnecting must not create duplicate tasks or runs.

The coordinator conversation belongs to the project. It must not be bound to one
feature branch or serve as the shared coding session for all features. Each worker
has its own task context and workspace. Project messages retain their association
with the feature or investigation they affected.

Basic context persistence and restart recovery belong in this first slice.
Recovery must reconcile stored state with actual provider and Git state before
resuming work. It must not blindly replay a launch.

### Acceptance test for the next feature

In a fresh calculator project, say: "Build a calculator number keypad, with no
operators yet." Yantrix creates the feature, prepares its workspace, and starts
the worker without a task form or manual chat/worktree linking. Progress and the
result are visible from the project conversation.

Then give a follow-up about that keypad. Yantrix routes it to the same feature
when appropriate. Reload the client and restart the server: project history,
feature ownership, and the next action survive, with no duplicate launch. Test
an informational question too: it must not unnecessarily create a coding task.

## Build order toward the full MVP

| Order | Deliverable                                                             | Acceptance evidence                                                                                                                                                |
| ----- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Project coordinator and automatic feature execution, as described above | A chat request produces real worker execution; follow-ups reuse the correct workspace; restart does not duplicate work.                                            |
| 2     | Concurrent workers and inferred prerequisites                           | Independent features make progress simultaneously within configured capacity; dependent work waits and resumes only after verified prerequisites are available.    |
| 3     | Automatic context maintenance and session replacement                   | Worker interruption or context rotation preserves decisions, evidence, pending questions, and workspace identity without requiring the user to repeat the feature. |
| 4     | Review and completion through the project attention view                | The user sees previews, checks, PRs, and decisions; verified merges update project context and dependent work without manual chat housekeeping.                    |

For concurrency, infer dependencies from required code and acceptance conditions.
Shared files indicate possible integration risk, not necessarily a prerequisite.
Serialize genuinely unsafe shared mutations or required upstream work. A worker
waiting on the user's answer must not block unrelated features. Steering, pausing,
or cancelling one feature must target that feature only.

For context, distinguish verified project facts from proposed branch changes,
task decisions, and user preferences. Retrieve relevant context within a bounded
budget instead of replaying every conversation. Save a durable handoff before
replacing a session, then validate the workspace when the replacement resumes.

## Calculator scenario for the full MVP

1. "Build a number keypad." Yantrix starts feature A.
2. "Add addition to that keypad." Yantrix recognizes feature B needs the keypad
   and records the prerequisite without requiring the user to specify it.
3. "Make the keypad look like the iOS calculator." Yantrix treats this as a
   distinct feature C when appropriate. Once the keypad foundation is available,
   C can proceed alongside addition; it does not inherently depend on B.
4. Follow up on C while B runs. Each worker receives the correct context.
5. Review and merge through the user's normal approval flow. Yantrix verifies the
   merge, reconciles other work, and reports the remaining actions.

Whether C needs A depends on the actual repository state. Calling tasks separate
does not imply they have no prerequisites. Yantrix must explain its decision and
allow correction.

## Boundaries

Start with one user, local execution, and one validated provider. Reuse the
existing task, workspace, event, and provider foundations. Explicitly describe
unsupported client/provider paths rather than implying universal support.
Multi-provider failover, hosting, and phone-first operation are later expansions.

Clear routine instructions should execute without repeated confirmations. The
user retains product decisions and merge approval. Do not silently merge PRs,
switch to a paid provider, discard work, or remove worktrees. Cleanup follows an
explicit policy and verified retention checks.

Firstmate inspires the coordinator/worker separation, isolated execution, and
durable scoped handoffs. It is a reference, not a drop-in orchestration backend;
adapt those principles to Yantrix's existing architecture.

## Starting the next session

Read `AGENTS.md`, `context.md`, and this file. Fetch `origin/main` and verify PR 6
was merged into the intended target. Create the next coding task's dedicated
worktree from that updated base; do not continue implementation in the closed
PR 6 branch or edit the main checkout. Implement order 1 as a complete vertical
slice, with the acceptance evidence above, before expanding to later stages.
