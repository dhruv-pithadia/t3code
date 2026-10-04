import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(yantrixHome: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(yantrixHome)) {
    return Option.none();
  }
  const trimmed = yantrixHome.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly yantrixHome: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.yantrixHome), () =>
    input.joinPath(input.homeDirectory, ".yantrix"),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly yantrixHome: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.yantrixHome));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
