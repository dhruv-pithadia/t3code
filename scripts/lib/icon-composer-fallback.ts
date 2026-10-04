// @effect-diagnostics nodeBuiltinImport:off - Build-time asset renderer runs outside the Effect runtime.
// Portable renderer for the Icon Composer projects in assets/*/app-icon.icon.
//
// Icon Composer 2 (`ictool`) is only available on macOS machines with a recent Xcode or the
// standalone app. When it is missing, this renders the same layer stack with sharp: layers are
// composited bottom to top at their Icon Composer positions on a 1024pt canvas. Glass,
// translucency, and specular effects are not reproduced, so the output is flat artwork.

import sharp, { type OverlayOptions } from "sharp";

const COMPOSER_CANVAS_PT = 1024;
const SVG_DENSITY = 300;
// Classic macOS icon grid: an 824pt body inset 100pt on a 1024pt canvas, 22.37% corner radius.
const MACOS_BODY_PT = 824;
const MACOS_CORNER_RADIUS_PT = 184;
const MACOS_SHADOW = { offsetY: 12, blur: 12 };

/** An Icon Composer project's `icon.json` and layer SVGs, keyed by file name, read by the caller. */
export interface IconComposerSource {
  readonly iconJson: string;
  readonly assets: Readonly<Record<string, string>>;
}

interface IconComposerLayer {
  readonly "image-name": string;
  readonly hidden?: boolean;
  readonly opacity?: number;
  readonly position?: {
    readonly scale?: number;
    readonly "translation-in-points"?: readonly [number, number];
  };
}

interface IconComposerProject {
  readonly fill?: { readonly solid?: string; readonly "automatic-gradient"?: string };
  readonly groups: ReadonlyArray<{ readonly layers: ReadonlyArray<IconComposerLayer> }>;
}

const parseDisplayP3 = (value: string | undefined) => {
  const match = value?.match(/display-p3:([\d.]+),([\d.]+),([\d.]+),([\d.]+)/);
  if (!match) return { r: 0, g: 0, b: 0, alpha: 1 };
  const channel = (raw: string | undefined) => Math.round(Number(raw) * 255);
  return {
    r: channel(match[1]),
    g: channel(match[2]),
    b: channel(match[3]),
    alpha: Number(match[4]),
  };
};

const svgDimensions = (svg: string) => {
  const width = svg.match(/<svg[^>]*\swidth="([\d.]+)"/)?.[1];
  const height = svg.match(/<svg[^>]*\sheight="([\d.]+)"/)?.[1];
  if (!width || !height) throw new Error("Icon Composer layer SVG needs width and height.");
  return { width: Number(width), height: Number(height) };
};

/** Renders a full-bleed square icon, the equivalent of an Icon Composer iOS export. */
export async function renderIconComposerProject(
  source: IconComposerSource,
  size: number,
): Promise<Buffer> {
  const project: IconComposerProject = JSON.parse(source.iconJson);
  const pixelsPerPoint = size / COMPOSER_CANVAS_PT;
  const fill = project.fill?.solid ?? project.fill?.["automatic-gradient"];

  // icon.json lists the top layer first.
  const layers = project.groups
    .flatMap((group) => group.layers)
    .filter((layer) => !layer.hidden)
    .toReversed();

  const overlays: OverlayOptions[] = [];
  for (const layer of layers) {
    // Layer sources clip to a 10pt rounded rectangle for the iOS silhouette. The system (or
    // the macOS mask below) applies the real corners, so the layer must bleed to the edge.
    const svg = (source.assets[layer["image-name"]] ?? "").replace(
      /<rect width="128" height="128" rx="10"\/>/,
      '<rect width="128" height="128"/>',
    );
    const natural = svgDimensions(svg);
    const scale = layer.position?.scale ?? 1;
    const [dx, dy] = layer.position?.["translation-in-points"] ?? [0, 0];
    const width = Math.max(1, Math.round(natural.width * scale * pixelsPerPoint));
    const height = Math.max(1, Math.round(natural.height * scale * pixelsPerPoint));
    const left = Math.round(size / 2 + dx * pixelsPerPoint - width / 2);
    const top = Math.round(size / 2 + dy * pixelsPerPoint - height / 2);

    let image = await sharp(Buffer.from(svg), { density: SVG_DENSITY })
      .resize(width, height)
      .ensureAlpha()
      .png()
      .toBuffer();
    if (layer.opacity !== undefined && layer.opacity < 1) {
      const alpha = Buffer.alloc(width * height, Math.round(layer.opacity * 255));
      image = await sharp(image)
        .composite([{ input: alpha, raw: { width, height, channels: 1 }, blend: "dest-in" }])
        .png()
        .toBuffer();
    }

    // sharp cannot place overlays at negative offsets, so crop to the canvas first.
    const cropLeft = Math.max(0, -left);
    const cropTop = Math.max(0, -top);
    const visibleWidth = Math.min(width - cropLeft, size - Math.max(0, left));
    const visibleHeight = Math.min(height - cropTop, size - Math.max(0, top));
    if (visibleWidth <= 0 || visibleHeight <= 0) continue;
    overlays.push({
      input: await sharp(image)
        .extract({ left: cropLeft, top: cropTop, width: visibleWidth, height: visibleHeight })
        .png()
        .toBuffer(),
      left: Math.max(0, left),
      top: Math.max(0, top),
    });
  }

  return sharp({
    create: { width: size, height: size, channels: 4, background: parseDisplayP3(fill) },
  })
    .composite(overlays)
    .png()
    .toBuffer();
}

/** Renders the classic macOS (pre-Tahoe) icon: rounded body inside the safe area plus shadow. */
export async function renderIconComposerMacOsProject(
  source: IconComposerSource,
  size: number,
): Promise<Buffer> {
  const pixelsPerPoint = size / COMPOSER_CANVAS_PT;
  const body = Math.round(MACOS_BODY_PT * pixelsPerPoint);
  const inset = Math.round((size - body) / 2);
  const radius = MACOS_CORNER_RADIUS_PT * pixelsPerPoint;
  const art = await renderIconComposerProject(source, body);

  const roundedMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${body}" height="${body}"><rect width="${body}" height="${body}" rx="${radius}" fill="#fff"/></svg>`,
  );
  const rounded = await sharp(art)
    .composite([{ input: roundedMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  const shadowSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${(MACOS_SHADOW.blur * pixelsPerPoint) / 2}"/></filter></defs><rect x="${inset}" y="${inset + MACOS_SHADOW.offsetY * pixelsPerPoint}" width="${body}" height="${body}" rx="${radius}" fill="#000" fill-opacity="0.5" filter="url(#s)"/></svg>`,
  );

  return sharp(shadowSvg, { density: 72 })
    .composite([{ input: rounded, left: inset, top: inset }])
    .png()
    .toBuffer();
}
