# Yantrix progress and feature ledger

This ledger tracks what Yantrix adds to its upstream foundation, what is still being built, and what
has actually landed. Use it to explain the product's differences without counting
inherited upstream capabilities as new Yantrix features.

## Comparison baseline

Yantrix builds on [T3 Code](https://github.com/pingdotgg/t3code). The initial fork
baseline is commit `4ee6bfd50e`, before Yantrix PR #1. Comparisons below refer to
that baseline, not every subsequent upstream release. Reassess an entry when
upstream changes are imported.

Conversations, provider integrations, agent execution, worktrees, pull-request
workflows, and the existing web, desktop, and mobile clients are inherited
foundations. Yantrix's additions extend those capabilities.

## Progress ledger

| ID     | Addition                          | Category               | Status | What it adds                                                                                                                                                     | Implementation record                                     |
| ------ | --------------------------------- | ---------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| YF-001 | Persistent feature tasks          | Product feature        | Merged | A durable objective, acceptance criteria, decisions, next action, and handoff shared across linked conversations and restarts.                                   | [PR #4](https://github.com/dhruv-pithadia/yantrix/pull/4) |
| YF-002 | Independent development workspace | Development foundation | Merged | Checkout-local application data, separate development identity and ports, and disabled updates for working on Yantrix alongside an installed upstream app.       | [PR #1](https://github.com/dhruv-pithadia/yantrix/pull/1) |
| YF-003 | Yantrix product identity          | Branding foundation    | Merged | Yantrix naming, assets, package and application identities, and configuration defaults. This establishes the fork's identity rather than a new agent capability. | [PR #3](https://github.com/dhruv-pithadia/yantrix/pull/3) |
| YF-004 | Task-owned workspaces             | Product feature        | Merged | One durable task workspace and branch shared by linked conversations, delivery state, and safe recovery when the workspace is unavailable or inconsistent.       | [PR #5](https://github.com/dhruv-pithadia/yantrix/pull/5) |

| YF-005 | Task prerequisites | Product feature | Draft | Explicit dependencies, verified prerequisite merges, and inherited workspaces and handoffs. | This task branch |

[PR #2](https://github.com/dhruv-pithadia/yantrix/pull/2) preserved the repository
setup and product direction in documentation. It is supporting work, not an
additional product feature.

**Current position:** persistent feature tasks (PR #4) and task-owned workspaces (PR #5)
are merged as of 5 October 2026, alongside two supporting foundations. Dependency-aware tasks are implemented in a draft pending final visual verification. A merged change is not automatically a
published release. No published Yantrix release is recorded here yet.

## YF-001: persistent feature tasks

**Difference:** the inherited workflow centers on conversations. Yantrix adds a
separate task record that can span multiple conversations, with its own saved
intent and progress notes.

| Capability added by this feature | What someone can do                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable task record              | Save the goal, criteria, decisions, next action, and handoff independently of a chat.                                                        |
| Linked conversations             | Attach existing conversations or start fresh ones for the same task; retain access to their workspace and PR details.                        |
| Restart recovery                 | Reopen Yantrix and resume a linked conversation with the saved task details intact.                                                          |
| Agent context continuity         | Give subsequent linked agent turns the latest saved task context; authorized agents can read and update it.                                  |
| Safe updates and recovery        | Detect conflicting edits, preserve unsaved input, reuse request IDs on launch retries, and retry linking separately after creation succeeds. |
| Task organization                | Track a progress status and archive or restore tasks through the web and mobile interfaces.                                                  |

**Evidence:** PR #4 records 144 passing focused tests, passing CI, and browser
verification of task creation, edits, linking, restart recovery, archive/restore,
and conflicting edits from two clients. Native mobile UI has not been verified
in a simulator.

**Boundaries:** task status is a progress note, not proof that tests passed or code
was merged. This feature does not add autonomous end-to-end task execution,
independent task workspace ownership, or automatic merging. Existing conversation
workspace and PR workflows are reused.

**How to explain it:**

> Yantrix builds on the upstream agent workspace and adds persistent feature tasks.
> A feature keeps its goal, decisions, and next step while you move between
> conversations or restart the app, so the work has continuity beyond one chat.

PR #4 merged on 5 October 2026. Persistent feature tasks are done and merged;
a published release containing them has not yet been recorded.

## YF-004: task-owned workspaces

**Difference:** a feature task owns a saved Git worktree and branch. New linked
conversations use that checkout rather than choosing their workspace separately.

| Capability              | What someone can do                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Isolated feature work   | Set up a separate worktree and branch when starting a task, or explicitly adopt a compatible registered worktree.                |
| Conversation continuity | Start fresh conversations in the same checkout and resume linked conversations after restarting Yantrix.                         |
| Delivery visibility     | Read the branch's pull request, check results, and merge state separately from the task's progress notes.                        |
| Safe recovery           | Restore a missing checkout from its saved branch commits, inspect mismatches, and explicitly choose another compatible worktree. |
| Workspace ownership     | Prevent incompatible links and simultaneous agent work in a shared task checkout.                                                |

**Boundaries:** delivery information depends on the source-control host and remains
unknown when it cannot be verified. Recovery cannot reconstruct missing uncommitted
files. Workspaces are retained when conversations are unlinked or tasks archived.
This feature does not merge pull requests or automatically delete worktrees.

**Evidence:** 192 focused tests passed across workspace ownership, recovery, delivery
freshness, provider start guards, authorization, MCP, and shared client behavior.
Targeted lint, formatting, server/contracts/web/mobile/client-runtime typechecks,
and the production web build passed. Headless Chromium verified restart continuity,
new linked conversations, branch mismatch launch blocking, committed recovery,
foreign-worktree refusal, offline edit preservation and reconnect retry, and responsive
web at 390px without overflow or browser page errors. The collapsible task inspector
was also verified for viewport bounds, independent scrolling, keyboard tabs, saved
visibility preferences, and repair drafts retained across collapse and resizing.

Native mobile was typechecked but not verified in a simulator. The browser fixture
had no matching pull request; changing PR/check states are covered by focused service
tests. Implementation is recorded in [PR #5](https://github.com/dhruv-pithadia/yantrix/pull/5).
PR #5 merged on 5 October 2026. CI results and browser screenshots are tracked on the PR.

## YF-005: task prerequisites

**Status:** Draft, pending remaining visual verification.

Tasks can explicitly depend on other tasks in the same project. Links survive restarts and reject
cycles. Web and mobile editors expose prerequisites; shared RPC and MCP paths enforce them.
Workspace checks and provider starts verify GitHub merge commits against a freshly fetched
`origin` default branch. Dependent work starts from that commit, while existing checkouts that
lack prerequisite merges remain blocked until integrated. Saved prerequisite handoffs accompany
linked agent turns. Work never starts or merges automatically.

**Boundaries:** GitHub `origin` repositories and default-branch merges only. No stacked branches,
background scheduler, automatic inference of dependencies, automatic integration, or cleanup.
Refresh or reopen to observe an external merge; agent starts always recheck.

**Evidence:** 84 focused tests pass, including real Git workspace checks, squash-merge ancestry,
PR target-branch configuration, cycle rejection, cross-project rejection, unavailable/closed PRs,
existing-work preservation, and prerequisite context delivery. The live private calculator
experiment kept addition blocked until keypad PR #1 merged with user approval, then provisioned
addition at the verified merge commit after restarting the server. Three calculator tests pass.
Browser interaction verified prerequisite selection, blocked launch, and keypad entry. Screenshot
capture failed and the collaborative browser disconnected before addition and responsive checks;
native mobile is typechecked only. The calculator addition PR remains draft and unmerged.

## Keeping this ledger current

- Add an entry in the same PR when building a new Yantrix-specific feature.
- Keep one entry per feature; describe its subcapabilities within that entry.
- Record the difference from the comparison baseline, the PR, evidence, and limits.
- Use **Planned**, **Building**, **Ready for review**, **Merged**, or **Released**.
  For **Released**, link the release that contains it.
- Update status when the PR merges or a release ships. Do not infer either from
  passing checks or an agent's completion message.
- Keep proposed ideas distinct from implemented features, and avoid counting
  branding, documentation, or inherited capabilities as new product features.
