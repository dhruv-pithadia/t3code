# Yantrix development

This is the Yantrix development checkout. The supported isolated entry points are `vp run dev`
(web) and `vp run dev:desktop` (Electron on macOS). Run them from the task worktree after `vp i`.
Use `--dry-run` to inspect paths and selected ports without starting services. Run one mode
at a time per worktree because web and desktop share that worktree's backend state.

Both launchers bind the backend to loopback, select ports from the checkout path, disable
app updates, and use checkout-local `.yantrix/workspace-runtime/userdata` for backend state.
Electron uses `.yantrix/workspace-electron` for its browser profile and displays
**Yantrix (Dev)**. No production conversations or credentials are copied.
The macOS dev bundle has a separate bundle ID and does not register Yantrix URL handlers.
Each worktree owns its own state. The launcher rejects data-directory overrides and paths
symlinked outside the checkout. Do not copy a live installation's `.env` into this fork.

The provider CLIs can still use the machine's existing provider sign-ins when you explicitly
start agent work. This is application-data isolation, not an OS sandbox or separate provider
quota. No provider session is started as part of repository setup.

Use the two root commands above. Direct package commands, the upstream CLI, service installation,
remote sharing, mobile clients, and distribution builds are not configured as isolated fork
entry points. Do not install a generated Yantrix-branded artifact or run `yantrix update` for this fork.
A distributable release needs its own bundle IDs, URL handlers, signing and update infrastructure.

Keep `origin` pointed at the personal fork and `upstream` at `pingdotgg/t3code`. Work on task
branches in dedicated worktrees and open PRs against the personal fork's `main`. Preserve the original
MIT license and third-party notices. Merge decisions remain with the repository owner.
