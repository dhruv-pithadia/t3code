# Feature tasks

Feature tasks keep an outcome, acceptance criteria, decisions, handoff, and next action together
across conversations. Open **Tasks**, choose a project, and create a task describing the result you
want. Start a conversation from the task to create a separate Git worktree and branch, or choose
**Set up workspace** first. Every new conversation for that task uses its saved checkout.
You can also attach a registered worktree from the same repository using **Use another worktree**.

Use **Resume** to return to a linked conversation. The latest saved task context accompanies
subsequent agent turns, including after reopening Yantrix. You can link another conversation in
the same project when you need a fresh conversation while retaining the task's intent. Each
conversation belongs to at most one feature task.

Keep the handoff focused on what changed, what was checked, unresolved questions, and what should
happen next. Agents can read and update this record using Yantrix's feature-task tools. Saved
context can contain mistakes; inspect the actual changes and validation before accepting work.

Choose **Prerequisites** when creating or editing a task to make it wait for other tasks in the
same project. For example, an addition feature can wait for a calculator keypad. Cycles and
self-dependencies are rejected. Remove a prerequisite in the editor when the requirement changes;
stop active task work before editing prerequisites.

The Workspace section checks prerequisites when opened or refreshed and the server checks again
before agent work. Use **Check again** after merging externally. This first version verifies
GitHub pull requests against the repository's `origin` and current default branch. Closed,
ambiguous, unavailable, and non-default-branch merges do not unblock work. A new dependent
workspace starts from a freshly fetched default-branch commit containing every verified merge,
including squash merges. An existing checkout must already contain those commits; otherwise
integrate the default branch yourself and check again. Yantrix preserves local work and never
resets or rebases it automatically. Dependent work starts only when you choose to start it.

Linked agent turns also receive the saved prerequisite handoffs. These are context notes, not
independent proof of correctness. Newer clients block launches when a task reports prerequisites but the host lacks support. Prerequisite selection is explicit; mentioning a dependency in prose
alone does not establish it unless an agent records the link through the task tools.

Task status is a progress note. **Ready for review** does not prove tests passed or confirm a
merge. The task's **Delivery** section reports its branch's pull request, checks, and merge state
from the source-control host. Refresh to check again; unavailable information stays unknown.
Review and merge approval still use the existing pull-request flow.

The **Workspace** section checks the saved checkout's repository and branch. If its folder is
missing, **Restore worktree** recreates it from the saved branch and commits. Missing uncommitted
files cannot be reconstructed from Git. A branch mismatch or conflicting checkout blocks agent
work until you repair it and choose **Check again**. Recovery does not reset, delete, or switch an
existing checkout.

Link only conversations using the task's checkout and branch. Older conversations retain their
original checkout; unlink incompatible conversations before assigning or changing the task's
workspace. Unlinking preserves the conversation and its history. Only one linked conversation
can run agent work in the shared task workspace at a time.

Archive a task to remove it from the active list; show archived tasks to restore it. Archiving
does not delete conversations or workspaces, stop running agents, or merge code. Archived task
context is no longer added to agent turns.

Edits are checked against the task's current version. If another client or agent changes the task
while you are editing, refresh its saved details before applying your changes again.
