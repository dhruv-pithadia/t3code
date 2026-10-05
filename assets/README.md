# Yantrix brand icons

The three `app-icon.icon` projects under `dev`, `nightly`, and `prod` are the source
of truth. Their `Assets/text.svg` files contain the plain Y mark.

Run `vp run icons:export` to regenerate web, marketing, desktop, and iOS icons, and
`vp run icons:export:android` for Android launcher, notification, and splash assets.
Run `vp run icons:check` to verify the standard generated exports.

The default portable renderer composites the existing SVG layers with sharp. This
keeps generated files reproducible across platforms. It exports flat artwork without
Icon Composer glass/specular effects. macOS icons retain an 824px body inset 100px
inside the 1024px canvas, with transparent corners and a shadow.

Native Icon Composer 2 exports are optional: set `ICON_COMPOSER_TOOL` explicitly.
That renderer produces different pixels and cannot export the pre-Tahoe macOS
preset through its CLI. Keep portable output in the repository unless deliberately
changing the renderer for all generated assets.

Do not hand-edit generated PNG, ICO, or WebP files. Update the SVG source or export
script and regenerate instead. Provider logos and third-party notices retain their
original identities.
