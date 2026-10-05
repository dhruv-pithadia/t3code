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
