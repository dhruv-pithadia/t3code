import {
  YANTRIX_PROJECT_FILE_NAME,
  type EnvironmentId,
  type YantrixProjectFile,
  type YantrixProjectFileScript,
} from "@yantrix/contracts";
import { parseYantrixProjectFile } from "@yantrix/shared/yantrixProjectFile";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<YantrixProjectFileScript> = [];

export interface YantrixProjectFileState {
  /**
   * - `valid`: yantrix.json exists and decoded.
   * - `invalid`: yantrix.json exists but fails to decode (the server then ignores
   *   the whole file, including `iconPath` and every script).
   * - `missing`: no readable yantrix.json at the workspace root.
   * - `loading`: the file query has not settled yet.
   */
  status: "loading" | "missing" | "invalid" | "valid";
  /** The decoded file when status is `valid`, null otherwise. */
  file: YantrixProjectFile | null;
  scripts: ReadonlyArray<YantrixProjectFileScript>;
}

/**
 * Decoded state of the project's checked-in `yantrix.json`, including whether the
 * file exists but is broken — which the runtime otherwise swallows silently.
 */
export function useYantrixProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): YantrixProjectFileState {
  const query = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    YANTRIX_PROJECT_FILE_NAME,
    cwd !== null,
  );
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  return useMemo(() => {
    if (contents === null) {
      return {
        status: isPending ? "loading" : "missing",
        file: null,
        scripts: NO_SCRIPTS,
      } as const;
    }
    const file = parseYantrixProjectFile(contents);
    if (file === null) {
      return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
    }
    return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
  }, [contents, isPending]);
}

/**
 * Scripts declared in the project's checked-in `yantrix.json`, offered in the
 * scripts menu for import. Missing, truncated, or invalid files resolve to
 * an empty list.
 */
export function useYantrixProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<YantrixProjectFileScript> {
  return useYantrixProjectFileState(environmentId, cwd).scripts;
}
