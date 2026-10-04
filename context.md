# Project handoff

## Product direction

Independent Agent Workspace is a working name for a public product fork of T3 Code.
The final product name is undecided. The founder wants humans to focus on one feature
or problem at a time while agents coordinate parallel work. The product should track
features, conversations, workspaces, PRs, decisions and merge state without requiring
the human to remember which chats and PRs were settled.

The core hypothesis is that a persistent feature task should outlive its chat and
provider session. This is a product direction, not an implemented feature. Broader
market demand and differentiation still need validation. T3 Code was selected as the
starting point to build on an existing agent interface rather than recreate the stack.

The workspace parent contains the original `PRODUCT-BRIEF.md` and `product-vision.html`.
These local discovery artifacts were preserved and are not part of this repository.
“Continuity” in the concept visualization is a placeholder, not an approved product name.

## Confirmed repository state

The public fork is [dhruv-pithadia/t3code](https://github.com/dhruv-pithadia/t3code).
`origin` points to this personal fork; `upstream` points to `pingdotgg/t3code`.
Pushing or merging in the fork does not publish changes to upstream. Contributing back
requires a deliberately targeted upstream PR. Preserve the original MIT license,
copyright notices and third-party notices when rebranding.

[PR #1](https://github.com/dhruv-pithadia/t3code/pull/1) established repository setup and
application isolation. GitHub confirms it was merged into the fork's `main` on
2026-10-04 UTC, at commit `64d4be24f9`. The user saw the development application running
and accepted the setup. This is a local development foundation, not a distributed release.

The enclosing workspace has a clean main checkout in `t3code/` and the retained setup
checkout in `worktrees/app-isolation/`. This documentation handoff uses that existing
checkout on `docs/session-handoff`, based on the merged fork `main`; no extra worktree
was created for documentation. No checkout was deleted. The development app and servers
were stopped at the user's request after verification; the installed T3 application
remains separate.

## Isolation and operation

Read the [fork development guide](docs/operations/independent-workspace.md) before launching.
The supported entry points are `vp run dev` and macOS `vp run dev:desktop`, one mode per
worktree at a time. They clear inherited T3 connection settings, use checkout-local
backend and Electron state, bind the backend to loopback, disable app updates, and avoid
registering T3 URL handlers. The desktop identifies itself as Independent Agent Workspace
(Dev), with a separate bundle ID. The existing T3 installation and its data were not modified.

This isolates application data, not the operating system or provider accounts. Provider
CLIs can still use existing machine sign-ins and quotas. No provider task was started
as part of setup. Remote/mobile entry points, installers, release signing and a separate
update service are not configured for the fork. The inherited installation commands
below the fork introduction in README install upstream T3 Code.

Dependencies were installed in the setup checkout. Its ignored `.t3/dev-env.sh` selects
the locally prepared toolchain when sourced from that checkout. Other checkouts should
follow repository setup instructions; do not assume this local helper is versioned or
copy the live application's environment or database.

## Validation and next action

Historical validation for PR #1 passed on `f49e96e1c2`: 29 focused tests, targeted lint
and type checks, and the full GitHub CI suite. The web app returned HTTP 200. Desktop
startup verified the fork bundle identity, separate profile and backend connection.
An initial cold launch had transient Electron resource errors; a second launch completed
cleanly. No automated visual/browser QA was performed. An existing highlighting test was
stabilized by controlling its assertion clock; production tokenization was unchanged.
These results describe the setup commit, not a fresh run for this documentation change.

Next: choose the product name and start a separate rebranding task from current fork
`main`. Update repository/app naming, visible branding, icons and relevant technical
identifiers consistently. Release distribution remains a separate decision. Do not
implement rebranding or feature continuity merely because they appear in this handoff.

For coding tasks, use a dedicated task worktree, branch and PR against the personal fork.
Keep handoffs with their task, register PRs in T3, verify CI and leave merging to the user.
Do not clean up worktrees without authorization. Future sessions should explicitly read
this file from an up-to-date checkout: no automatic startup-reading rule was added.
