// Reject accidental reintroduction of upstream product identity when merging updates.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

const files = NodeChildProcess.execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  },
)
  .split("\0")
  .filter(Boolean);
const legacyBrand =
  /T3 Code|T3 Pro|@t3tools\b|\bt3code\b|\bt3-code\b|t3\.codes|\.t3\/|\bt3\.json\b/i;
const provenanceFiles = new Set([
  "README.md",
  "context.md",
  "YANTRIX_PROGRESS.md",
  "docs/operations/independent-workspace.md",
  "third-party-licenses.config.json",
  "scripts/lib/third-party-licenses.test.ts",
]);
const failures = [];
for (const file of new Set(files)) {
  if (
    file === "scripts/check-branding.mjs" ||
    file.startsWith(".repos/") ||
    file.includes("/Vendor/") ||
    /(?:^|\/)(?:LICENSE[^/]*|NOTICE[^/]*|THIRD_PARTY[^/]*|CHANGELOG\.md)$/i.test(file)
  )
    continue;
  let contents;
  try {
    if (!NodeFS.lstatSync(file).isFile()) continue;
    const bytes = NodeFS.readFileSync(file);
    if (bytes.includes(0)) continue;
    contents = bytes.toString("utf8");
  } catch {
    continue;
  } // Deleted paths are still in the index before staging.
  if (legacyBrand.test(file)) failures.push(file);
  for (const [index, line] of contents.split("\n").entries()) {
    if (!legacyBrand.test(line)) continue;
    if (/copyright|©/i.test(line)) continue;
    if (
      provenanceFiles.has(file) &&
      /github\.com\/(?:pingdotgg\/t3code|Yash-Singh1\/ghostty\/tree\/t3code)|`pingdotgg\/t3code`/.test(
        line,
      )
    )
      continue;
    failures.push(`${file}:${index + 1}`);
  }
}
if (failures.length) {
  console.error(`Unexpected upstream branding:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Yantrix branding check passed (license and upstream provenance preserved).");
}
