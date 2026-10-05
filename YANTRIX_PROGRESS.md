# Yantrix progress and feature ledger

This ledger tracks what Yantrix adds to T3 Code, what is still being built, and what
has actually landed. Use it to explain the product's differences without counting
inherited T3 Code capabilities as new Yantrix features.

## Comparison baseline

Yantrix builds on [T3 Code](https://github.com/pingdotgg/t3code). The initial fork
baseline is commit `4ee6bfd50e`, before Yantrix PR #1. Comparisons below refer to
that baseline, not every subsequent upstream release. Reassess an entry when
upstream changes are imported.

Conversations, provider integrations, agent execution, worktrees, pull-request
workflows, and the existing web, desktop, and mobile clients are inherited
foundations. Yantrix's additions extend those capabilities.

## Progress ledger

| ID     | Addition                          | Category               | Status                       | What it adds                                                                                                                                                     | Implementation record                                     |
| ------ | --------------------------------- | ---------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| YF-001 | Persistent feature tasks          | Product feature        | Ready for review, not merged | A durable objective, acceptance criteria, decisions, next action, and handoff shared across linked conversations and restarts.                                   | [PR #4](https://github.com/dhruv-pithadia/yantrix/pull/4) |
| YF-002 | Independent development workspace | Development foundation | Merged                       | Checkout-local application data, separate development identity and ports, and disabled updates for working on Yantrix alongside an installed T3 Code app.        | [PR #1](https://github.com/dhruv-pithadia/yantrix/pull/1) |
| YF-003 | Yantrix product identity          | Branding foundation    | Merged                       | Yantrix naming, assets, package and application identities, and configuration defaults. This establishes the fork's identity rather than a new agent capability. | [PR #3](https://github.com/dhruv-pithadia/yantrix/pull/3) |

[PR #2](https://github.com/dhruv-pithadia/yantrix/pull/2) preserved the repository
setup and product direction in documentation. It is supporting work, not an
additional product feature.

**Current position:** one new product feature is implemented and awaiting merge;
two supporting foundations are merged. A merged change is not automatically a
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

> Yantrix builds on T3 Code's agent workspace and adds persistent feature tasks.
> A feature keeps its goal, decisions, and next step while you move between
> conversations or restart the app, so the work has continuity beyond one chat.

Until PR #4 is merged and available in a build, describe this as implemented and
under review, rather than available in a released version.

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
