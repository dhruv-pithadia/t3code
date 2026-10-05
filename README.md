# Yantrix

Yantrix is a workspace for coding agents, with web, desktop, and mobile clients.
It works with the supported provider tools and their existing sign-ins.
The current release is a local development foundation. Feature continuity is planned.

## Development

Use Node 24 and Vite+. From a dedicated task checkout:

```sh
vp install
vp run dev
# macOS desktop, instead of the web development command:
vp run dev:desktop
```

The launchers use checkout-local `.yantrix` state, loopback networking, separate
Electron storage, and disabled updates. See the [development guide](docs/operations/independent-workspace.md).

Public installers, npm distribution, mobile store listings, signing, and hosted
services are not configured yet. Do not install an unrelated package with the same
name. Cloud integrations require your own configuration; `.env.example` contains
no upstream account identifiers. Publishing workflows are disabled unless the
repository variable `YANTRIX_ENABLE_EXTERNAL_WORKFLOWS` is explicitly enabled.

## Upstream and license

Yantrix is derived from [T3 Code](https://github.com/pingdotgg/t3code).
`origin` points to [this fork](https://github.com/dhruv-pithadia/yantrix);
`upstream` remains the original repository for reviewed code updates.
The original [MIT license](LICENSE), copyright, and third-party notices are preserved.
