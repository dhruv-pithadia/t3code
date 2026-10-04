import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { YantrixProjectFile, YANTRIX_PROJECT_FILE_SCHEMA_URL } from "@yantrix/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `yantrix.json` file contents (lenient JSONC string) and the
 * decoded {@link YantrixProjectFile}.
 */
export const YantrixProjectFileFromJson = fromLenientJson(YantrixProjectFile);

const decodeYantrixProjectFile = Schema.decodeExit(YantrixProjectFileFromJson);

/**
 * Decode raw `yantrix.json` contents, treating invalid or malformed files as
 * absent. Clients use this to read optional defaults (scripts, thread env
 * mode) without surfacing decode errors to the user.
 */
export function parseYantrixProjectFile(contents: string): YantrixProjectFile | null {
  const decoded = decodeYantrixProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/**
 * Build the publishable JSON Schema document for `yantrix.json` (draft 2020-12).
 *
 * Served from the marketing site at {@link YANTRIX_PROJECT_FILE_SCHEMA_URL} so
 * editors get LSP support via a `$schema` reference.
 */
export function buildYantrixProjectFileJsonSchema(): Record<string, unknown> {
  // Closed objects, as before effect rc.113 changed the generator default;
  // editors then flag unknown keys in yantrix.json.
  const document = Schema.toJsonSchemaDocument(YantrixProjectFile, { onExcessProperty: "error" });
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: YANTRIX_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
