/**
 * YantrixProjectFileLoader - Effect service that loads the checked-in `yantrix.json`
 * project file from a workspace root.
 *
 * Loading is best-effort: a missing file resolves to `Option.none`, and
 * unreadable or invalid files are logged and treated as absent so callers
 * can fall back to their defaults.
 *
 * @module YantrixProjectFileLoader
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { YANTRIX_PROJECT_FILE_NAME, type YantrixProjectFile } from "@yantrix/contracts";
import { YantrixProjectFileFromJson } from "@yantrix/shared/yantrixProjectFile";

const decodeYantrixProjectFileJson = Schema.decodeEffect(YantrixProjectFileFromJson);

export class YantrixProjectFileLoadError extends Schema.TaggedError<YantrixProjectFileLoadError>()(
  "YantrixProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${YANTRIX_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

/** Service tag for yantrix.json project file loading. */
export class YantrixProjectFileLoader extends Context.Service<
  YantrixProjectFileLoader,
  {
    /**
     * Load and decode `yantrix.json` at the workspace root.
     *
     * Never fails: missing, unreadable, or invalid files resolve to
     * `Option.none` (invalid files are logged as warnings).
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<YantrixProjectFile>>;
  }
>()("yantrix/project/YantrixProjectFileLoader") {}

const logYantrixProjectFileLoadError = (error: YantrixProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: YantrixProjectFileLoader["Service"]["load"] = Effect.fn(
    "YantrixProjectFileLoader.load",
  )(function* (workspaceRoot) {
    const filePath = path.join(workspaceRoot, YANTRIX_PROJECT_FILE_NAME);
    const raw = yield* fileSystem.readFileString(filePath).pipe(
      Effect.asSome,
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : logYantrixProjectFileLoadError(
                new YantrixProjectFileLoadError({
                  operation: "read",
                  workspaceRoot,
                  filePath,
                  cause: error,
                }),
              ).pipe(Effect.as(Option.none<string>())),
      }),
    );
    if (Option.isNone(raw)) {
      return Option.none<YantrixProjectFile>();
    }
    return yield* decodeYantrixProjectFileJson(raw.value).pipe(
      Effect.asSome,
      Effect.catchTags({
        SchemaError: (error) =>
          logYantrixProjectFileLoadError(
            new YantrixProjectFileLoadError({
              operation: "decode",
              workspaceRoot,
              filePath,
              cause: error,
            }),
          ).pipe(Effect.as(Option.none<YantrixProjectFile>())),
      }),
    );
  });

  return YantrixProjectFileLoader.of({ load });
});

export const layer = Layer.effect(YantrixProjectFileLoader, make);
