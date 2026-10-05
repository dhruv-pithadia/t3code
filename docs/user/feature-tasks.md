# Feature tasks

Feature tasks keep an outcome, acceptance criteria, decisions, handoff, and next action together
across conversations. Open **Tasks**, choose a project, and create a task describing the result you
want. Link an existing conversation or start one from the task.

Use **Resume** to return to a linked conversation. The latest saved task context accompanies
subsequent agent turns, including after reopening Yantrix. You can link another conversation in
the same project when you need a fresh conversation while retaining the task's intent. Each
conversation belongs to at most one feature task.

Keep the handoff focused on what changed, what was checked, unresolved questions, and what should
happen next. Agents can read and update this record using Yantrix's feature-task tools. Saved
context can contain mistakes; inspect the actual changes and validation before accepting work.

Task status is a progress note. **Ready for review** does not prove tests passed, and a task status
does not confirm a merge. Linked conversations retain their existing workspace and pull-request
details. Review and merge approval still use the existing pull-request flow.

Archive a task to remove it from the active list; show archived tasks to restore it. Archiving
does not delete conversations or workspaces, stop running agents, or merge code. Archived task
context is no longer added to agent turns.

Edits are checked against the task's current version. If another client or agent changes the task
while you are editing, refresh its saved details before applying your changes again.
