# Project handoff

## Product direction

Yantrix is the approved product name. The temporary mark is a plain Y. Keep the
existing interface styling and workflows. Feature tasks persist the objective, decisions, next action, and handoff independently
of chats and provider sessions. Linked conversations supply workspace and PR context;
task status remains a progress note rather than proof of verification or merging.

Track Yantrix-specific additions and their delivery status in
[the progress and feature ledger](YANTRIX_PROGRESS.md). Update it with each new feature PR.

## Repository and isolation

`origin` is https://github.com/dhruv-pithadia/yantrix. The `upstream` remote remains
https://github.com/pingdotgg/t3code for reviewed code updates. Preserve the original
MIT license, third-party attribution, and Git history.

Use `vp run dev` or macOS `vp run dev:desktop`, one mode per task worktree. The launchers
use `.yantrix/workspace-runtime` and `.yantrix/workspace-electron`, loopback networking,
separate desktop identity, and disabled auto-updates. See
[development](docs/operations/independent-workspace.md).
Existing installed upstream data is not migrated, copied, or opened for writing.
Provider CLIs retain their own machine sign-ins and quotas.

## Rebranding scope

The Yantrix task renames packages, CLI, environment variables, native modules,
application identity, project configuration, UI copy, and brand assets. No public
Yantrix hosting, signing, store listings, or cloud accounts have been provisioned.
Cloud integration settings must be supplied by the owner. Reserved `.invalid`
origins prevent inherited defaults from contacting a real third-party service.
External publishing workflows require `YANTRIX_ENABLE_EXTERNAL_WORKFLOWS=true`.
Do not enable them until their destinations and credentials have been configured.

Keep coding changes in the task worktree and PR. The user decides when to merge.
Do not delete retained worktrees without an explicit cleanup request.
