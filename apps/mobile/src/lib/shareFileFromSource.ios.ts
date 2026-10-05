import { requireNativeModule } from "expo";
import type { SharingOptions } from "expo-sharing";

const NativeControls = requireNativeModule<{
  shareFileFromSource(uri: string, title: string, sourceIdentifier: string): Promise<void>;
}>("YantrixNativeControls");

export function shareFileFromSource(
  uri: string,
  options: SharingOptions,
  sourceIdentifier: string,
) {
  return NativeControls.shareFileFromSource(uri, options.dialogTitle ?? "", sourceIdentifier);
}
