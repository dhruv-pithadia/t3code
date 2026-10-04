import type { APIRoute } from "astro";

import { buildYantrixProjectFileJsonSchema } from "@yantrix/shared/yantrixProjectFile";

// Rendered at build time; published at https://yantrix.invalid/schema/yantrix.json so
// yantrix.json files can reference it via "$schema" for editor/LSP support.
export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildYantrixProjectFileJsonSchema(), null, 2)}\n`, {
    headers: { "Content-Type": "application/json" },
  });
