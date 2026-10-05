import type { FeatureTaskDelivery, FeatureTaskWorkspaceResult } from "@yantrix/contracts";
import {
  describeFeatureTaskDelivery,
  describeFeatureTaskError,
  describeFeatureTaskWorkspace,
  validateWorktreeAttachPath,
  type DeliveryTone,
  type FeatureTaskWorkspaceAction,
} from "@yantrix/client-runtime/state/feature-task-workspace";
import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, View } from "react-native";

import { AppText as Text, AppTextInput } from "../../components/AppText";
import { SettingsSection } from "../settings/components/SettingsSection";

const TONE_CLASS: Record<DeliveryTone, string> = {
  neutral: "border-border text-foreground-muted",
  unknown: "border-border text-foreground-muted",
  pending: "border-warning-border text-warning-foreground",
  success: "border-border text-emerald-500",
  danger: "border-danger-border text-danger-foreground",
};

/** Tone colors the label, and the label always says the state in words. */
function ToneChip(props: { readonly tone: DeliveryTone; readonly label: string }) {
  return (
    <View className={`rounded-full border px-2.5 py-1 ${TONE_CLASS[props.tone].split(" ")[0]}`}>
      <Text className={`text-xs font-yantrix-medium ${TONE_CLASS[props.tone].split(" ")[1]}`}>
        {props.label}
      </Text>
    </View>
  );
}

const ACTION_LABEL: Record<FeatureTaskWorkspaceAction, string> = {
  prepare: "Set up workspace",
  restore: "Restore worktree",
  attach: "Use another worktree",
  recheck: "Check again",
};

function ActionButton(props: {
  readonly label: string;
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      className={`min-h-11 items-center justify-center rounded-xl border px-4 active:opacity-70 ${props.primary ? "border-primary bg-primary" : "border-border bg-card"} ${props.disabled ? "opacity-50" : ""}`}
      onPress={props.onPress}
    >
      <Text
        className={`text-sm font-yantrix-medium ${props.primary ? "text-primary-foreground" : "text-foreground"}`}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

/** The task's own worktree and branch. Repairs are explicit; nothing is moved or reset. */
export function TaskWorkspaceSection(props: {
  readonly workspace: FeatureTaskWorkspaceResult | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly archived: boolean;
  readonly working: boolean;
  readonly onAction: (action: FeatureTaskWorkspaceAction, worktreePath?: string) => void;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachPath, setAttachPath] = useState("");
  const [attachInvalid, setAttachInvalid] = useState<string | null>(null);
  const description = props.workspace ? describeFeatureTaskWorkspace(props.workspace) : null;
  // A failed re-check keeps the previous report around. It is history, not current health.
  const stale = props.error !== null && props.workspace !== null;
  // Reactive queries keep the previous report while they wait (for example for a reconnect).
  const checking = !stale && props.isPending && props.workspace !== null;
  const unverified = stale || checking;
  const binding = props.workspace?.binding ?? null;
  const actions = (description?.actions ?? []).filter(
    (action) => action === "recheck" || (!props.archived && !unverified),
  );

  return (
    <SettingsSection title="Workspace">
      <View className="gap-3 p-4">
        {description ? (
          <ToneChip
            tone={stale ? "unknown" : checking ? "neutral" : description.tone}
            label={unverified ? `Last known: ${description.label}` : description.label}
          />
        ) : props.isPending ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <Text className="text-sm text-foreground-muted">Checking workspace</Text>
          </View>
        ) : null}
        {props.workspace?.dependencies?.map((item) => (
          <View key={item.id} className="gap-1">
            <Text className="text-sm font-yantrix-medium">{item.title}</Text>
            <Text className="text-xs text-foreground-muted">
              {unverified ? "Last known: " : ""}
              {item.message}
            </Text>
          </View>
        ))}
        {binding ? (
          <View className="gap-2">
            <View>
              <Text className="text-xs text-foreground-muted">Branch</Text>
              <Text className="text-sm text-foreground" selectable>
                {binding.branch}
              </Text>
            </View>
            <View>
              <Text className="text-xs text-foreground-muted">Worktree</Text>
              <Text className="text-xs text-foreground" selectable>
                {binding.worktreePath}
              </Text>
            </View>
          </View>
        ) : null}
        {checking ? (
          <Text accessibilityRole="alert" className="text-sm leading-5 text-foreground-muted">
            Checking the workspace. Starting work is paused until this finishes.
          </Text>
        ) : null}
        {description && !unverified ? (
          <Text className="text-sm leading-5 text-foreground-muted">{description.detail}</Text>
        ) : null}
        {props.error ? (
          <Text accessibilityRole="alert" className="text-sm leading-5 text-danger-foreground">
            Could not check the workspace. {describeFeatureTaskError(props.error)}
            {stale ? " Starting work is paused until it can be checked." : ""}
          </Text>
        ) : null}
        {attachOpen ? (
          <View className="gap-2">
            <Text className="text-xs text-foreground-muted">
              Absolute path of an existing worktree for this repository
            </Text>
            <AppTextInput
              value={attachPath}
              onChangeText={(value) => {
                setAttachPath(value);
                setAttachInvalid(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={binding?.repoPath ?? "/path/to/worktree"}
              className="min-h-11 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
            />
            {attachInvalid ? (
              <Text accessibilityRole="alert" className="text-sm leading-5 text-danger-foreground">
                {attachInvalid}
              </Text>
            ) : null}
            <View className="flex-row gap-2">
              <ActionButton
                primary
                label="Review"
                disabled={props.working || attachPath.trim().length === 0}
                onPress={() => {
                  const invalid = validateWorktreeAttachPath(attachPath, binding);
                  setAttachInvalid(invalid);
                  if (invalid !== null) return;
                  const path = attachPath.trim();
                  Alert.alert(
                    "Use this worktree?",
                    `${path}\n\nNew conversations for this task will run here. Existing conversations are not moved. The server checks that it is a worktree of the same repository and that every linked conversation matches the chosen worktree and branch. It refuses otherwise. Nothing is deleted or reset.`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Attach worktree",
                        onPress: () => {
                          props.onAction("attach", path);
                          setAttachOpen(false);
                          setAttachPath("");
                        },
                      },
                    ],
                  );
                }}
              />
              <ActionButton
                label="Cancel"
                onPress={() => {
                  setAttachOpen(false);
                  setAttachInvalid(null);
                }}
              />
            </View>
          </View>
        ) : actions.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {actions.map((action, index) => (
              <ActionButton
                key={action}
                label={ACTION_LABEL[action]}
                primary={index === 0 && action !== "recheck"}
                disabled={props.working || (action !== "recheck" && props.isPending)}
                onPress={() => (action === "attach" ? setAttachOpen(true) : props.onAction(action))}
              />
            ))}
          </View>
        ) : null}
        {!props.workspace && props.error ? (
          <ActionButton label="Retry" onPress={() => props.onAction("recheck")} />
        ) : null}
      </View>
    </SettingsSection>
  );
}

/** Pull request, checks, and merge state as the host reports them, never inferred from task status. */
export function TaskDeliverySection(props: {
  readonly delivery: FeatureTaskDelivery | null;
  /** False until the task owns a worktree and branch; there is nothing to look up before that. */
  readonly hasWorkspace: boolean;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly onRefresh: () => void;
}) {
  const description = props.delivery ? describeFeatureTaskDelivery(props.delivery) : null;
  const pullRequest = props.delivery?.pullRequest ?? null;
  return (
    <SettingsSection title="Delivery">
      <View className="gap-3 p-4">
        {description && props.delivery ? (
          <>
            <View className="flex-row flex-wrap gap-2">
              <ToneChip tone={description.tone} label={description.headline} />
              {description.checks ? (
                <ToneChip tone={description.checks.tone} label={description.checks.label} />
              ) : null}
              {description.merge ? (
                <ToneChip tone={description.merge.tone} label={description.merge.label} />
              ) : null}
            </View>
            {pullRequest ? (
              <Pressable
                accessibilityRole="link"
                className="min-h-11 justify-center"
                onPress={() => void Linking.openURL(pullRequest.url)}
              >
                <Text className="text-sm text-primary" numberOfLines={2}>
                  {pullRequest.title}
                </Text>
                <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                  {pullRequest.headBranch} into {pullRequest.baseBranch}
                </Text>
              </Pressable>
            ) : (
              <Text className="text-sm leading-5 text-foreground-muted">
                {!props.hasWorkspace
                  ? "Set up the task workspace to check delivery. A pull request is looked up from the task's branch."
                  : props.delivery.updatedAt === null
                    ? "Delivery state could not be read from the host."
                    : "Open a pull request from this task's branch to track checks and merging here."}
              </Text>
            )}
            <Text className="text-xs text-foreground-muted">
              {props.error !== null
                ? props.delivery.updatedAt
                  ? `Last known from ${new Date(props.delivery.updatedAt).toLocaleString()}`
                  : "Last known, time unavailable"
                : props.delivery.updatedAt
                  ? `Checked ${new Date(props.delivery.updatedAt).toLocaleString()}`
                  : "Not checked yet"}
            </Text>
          </>
        ) : props.isPending ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <Text className="text-sm text-foreground-muted">Loading delivery state</Text>
          </View>
        ) : null}
        {props.error ? (
          <Text accessibilityRole="alert" className="text-sm leading-5 text-danger-foreground">
            Could not load delivery state. {describeFeatureTaskError(props.error)}
          </Text>
        ) : null}
        <ActionButton
          label={props.isPending ? "Refreshing" : "Refresh delivery"}
          disabled={props.isPending}
          onPress={props.onRefresh}
        />
      </View>
    </SettingsSection>
  );
}
