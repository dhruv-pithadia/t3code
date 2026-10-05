import {
  YANTRIX_PROJECT_FILE_NAME,
  type EnvironmentId,
  type YantrixProjectFile,
} from "@yantrix/contracts";
import { parseYantrixProjectFile } from "@yantrix/shared/yantrixProjectFile";
import { executeAtomQuery } from "@yantrix/client-runtime/state/runtime";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

/**
 * Read and decode the project's checked-in `yantrix.json`.
 *
 * Imperative counterpart to `useYantrixProjectFileState` for the new-thread path,
 * which resolves defaults at call time rather than render time. The file
 * query atom caches per (environment, cwd), so repeat calls don't re-fetch.
 * Optimistic in-app writes overlay the query result, matching what
 * `useProjectFileQuery` renders. Missing, truncated, or invalid files
 * resolve to null.
 */
export async function readYantrixProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<YantrixProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(environmentId, workspaceRoot, YANTRIX_PROJECT_FILE_NAME),
    { reportDefect: false, reportFailure: false },
  );
  const data = resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    YANTRIX_PROJECT_FILE_NAME,
    result._tag === "Success" ? result.value : null,
  );
  if (data === null || data.truncated) return null;
  return parseYantrixProjectFile(data.contents);
}
