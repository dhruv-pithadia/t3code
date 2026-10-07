import type { CoordinatorLedgerStorage } from "@yantrix/client-runtime/state/project-coordinator";

import { writeFileAtomically } from "../lib/atomic-file";

const COORDINATOR_REQUEST_DIRECTORY = "coordinator-requests";

async function getFile(key: string) {
  const { Directory, File, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.document, COORDINATOR_REQUEST_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  return new File(directory, `${encodeURIComponent(key)}.json`);
}

/**
 * Keeps unconfirmed coordinator request ids in the app's documents, one small
 * file per project, so a retried message keeps its id after the app restarts.
 */
export const coordinatorRequestFileStorage: CoordinatorLedgerStorage = {
  getItem: async (key) => {
    const file = await getFile(key);
    return file.exists ? await file.text() : null;
  },
  setItem: async (key, value) => {
    await writeFileAtomically(await getFile(key), value);
  },
  removeItem: async (key) => {
    const file = await getFile(key);
    if (file.exists) file.delete();
  },
};
