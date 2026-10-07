import { useNavigation } from "@react-navigation/native";
import {
  deriveCoordinatorAttention,
  describeCoordinatorError,
  describeCoordinatorRequest,
  notificationKindLabel,
  sortCoordinatorRequests,
} from "@yantrix/client-runtime/state/project-coordinator";
import { squashAtomCommandFailure } from "@yantrix/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectCoordinatorRequest,
  ProjectCoordinatorSnapshot,
} from "@yantrix/contracts";
import { memo, useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useObserveCoordinatorNotification } from "../../state/project-coordinator";

const VISIBLE_REQUESTS = 5;
const VISIBLE_DECISIONS = 5;

const TONE_CLASS: Record<ReturnType<typeof describeCoordinatorRequest>["tone"], string> = {
  neutral: "text-foreground-muted",
  progress: "text-foreground",
  success: "text-foreground",
  warning: "text-foreground",
};

/** Source message ids are evidence references, shown short and never as a claim about content. */
const shortId = (id: string) => (id.length > 8 ? id.slice(-8) : id);

function LinkButton(props: { readonly label: string; readonly onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      hitSlop={8}
      className="min-h-11 justify-center active:opacity-60"
    >
      <Text className="text-sm font-yantrix-medium text-foreground underline">{props.label}</Text>
    </Pressable>
  );
}

function WorkLinks(props: {
  readonly environmentId: EnvironmentId;
  readonly taskId: ProjectCoordinatorRequest["taskId"];
  readonly workerThreadId: ProjectCoordinatorRequest["workerThreadId"];
}) {
  const navigation = useNavigation();
  if (props.taskId === null && props.workerThreadId === null) return null;
  const { workerThreadId, taskId } = props;
  return (
    <View className="flex-row flex-wrap gap-x-5">
      {workerThreadId !== null ? (
        <LinkButton
          label="Open worker chat"
          onPress={() =>
            navigation.navigate("Thread", {
              environmentId: String(props.environmentId),
              threadId: String(workerThreadId),
            })
          }
        />
      ) : null}
      {taskId !== null ? (
        <LinkButton
          label="View task"
          onPress={() =>
            navigation.navigate("FeatureTaskDetail", {
              environmentId: String(props.environmentId),
              taskId: String(taskId),
            })
          }
        />
      ) : null}
    </View>
  );
}

function SectionTitle(props: { readonly children: string }) {
  return (
    <Text className="text-xs font-yantrix-semibold uppercase text-foreground-muted">
      {props.children}
    </Text>
  );
}

/**
 * Compact project state above the coordinator composer: what needs the user,
 * how each request was routed, and the decisions on record. Collapsed by
 * default so the conversation keeps the screen on small phones.
 */
export const CoordinatorStatusCard = memo(function CoordinatorStatusCard(props: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: ProjectCoordinatorSnapshot;
}) {
  const { environmentId, snapshot } = props;
  const [expanded, setExpanded] = useState(false);
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [observing, setObserving] = useState<ReadonlySet<string>>(() => new Set());
  const observe = useObserveCoordinatorNotification();

  const attention = useMemo(() => deriveCoordinatorAttention(snapshot), [snapshot]);
  const requests = useMemo(() => sortCoordinatorRequests(snapshot.requests), [snapshot.requests]);
  const visibleRequests = showAllRequests ? requests : requests.slice(0, VISIBLE_REQUESTS);
  const activeCount = attention.activeRequests.length;

  const observeNotification = useCallback(
    async (id: string) => {
      setObserving((current) => new Set(current).add(id));
      const result = await observe({ environmentId, input: { projectId: snapshot.projectId, id } });
      setObserving((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      if (result._tag === "Failure") {
        Alert.alert(
          "Could not mark as seen",
          describeCoordinatorError(squashAtomCommandFailure(result)),
        );
      }
    },
    [environmentId, observe, snapshot.projectId],
  );

  const summary = [
    attention.attentionCount > 0
      ? `${attention.attentionCount} need${attention.attentionCount === 1 ? "s" : ""} attention`
      : null,
    activeCount > 0 ? `${activeCount} in progress` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View className="mx-4 mb-2 overflow-hidden rounded-2xl border border-border bg-card">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Project status. ${summary || "Nothing yet"}`}
        onPress={() => setExpanded((value) => !value)}
        className="min-h-11 flex-row items-center gap-2 px-4 active:opacity-75"
      >
        <SymbolView name={expanded ? "chevron.down" : "chevron.right"} size={13} />
        <Text className="text-sm font-yantrix-semibold text-foreground">Project status</Text>
        <Text className="min-w-0 flex-1 text-sm text-foreground-muted" numberOfLines={1}>
          {summary || "Nothing yet"}
        </Text>
      </Pressable>
      {expanded ? (
        <ScrollView
          style={{ maxHeight: 280 }}
          contentContainerClassName="gap-4 px-4 pb-4"
          nestedScrollEnabled
        >
          {attention.openNotifications.length > 0 ? (
            <View className="gap-2">
              <SectionTitle>Needs attention</SectionTitle>
              {attention.openNotifications.map((notification) => (
                <View key={notification.id} className="gap-1">
                  <Text className="text-xs font-yantrix-semibold text-foreground">
                    {notificationKindLabel(notification.kind)}
                  </Text>
                  <Text className="text-sm text-foreground-muted">{notification.summary}</Text>
                  <WorkLinks
                    environmentId={environmentId}
                    taskId={notification.taskId}
                    workerThreadId={notification.workerThreadId}
                  />
                  {notification.observedAt === null ? (
                    <LinkButton
                      label={observing.has(notification.id) ? "Marking seen..." : "Mark seen"}
                      onPress={() => {
                        if (!observing.has(notification.id))
                          void observeNotification(notification.id);
                      }}
                    />
                  ) : (
                    <Text className="text-xs text-foreground-muted">Seen</Text>
                  )}
                </View>
              ))}
            </View>
          ) : null}
          <View className="gap-2">
            <SectionTitle>Requests</SectionTitle>
            {requests.length === 0 ? (
              <Text className="text-sm text-foreground-muted">
                Messages you send here appear as requests with their status.
              </Text>
            ) : (
              visibleRequests.map((request) => {
                const presentation = describeCoordinatorRequest(request);
                return (
                  <View key={request.id} className="gap-1">
                    <Text className="text-sm text-foreground" numberOfLines={2}>
                      {request.text}
                    </Text>
                    <Text className="text-xs font-yantrix-semibold text-foreground">
                      {presentation.label}
                    </Text>
                    {presentation.detail ? (
                      <Text className={`text-xs ${TONE_CLASS[presentation.tone]}`}>
                        {presentation.detail}
                      </Text>
                    ) : null}
                    <WorkLinks
                      environmentId={environmentId}
                      taskId={request.taskId}
                      workerThreadId={request.workerThreadId}
                    />
                  </View>
                );
              })
            )}
            {requests.length > VISIBLE_REQUESTS ? (
              <LinkButton
                label={
                  showAllRequests ? "Show fewer" : `Show ${requests.length - VISIBLE_REQUESTS} more`
                }
                onPress={() => setShowAllRequests((value) => !value)}
              />
            ) : null}
          </View>
          {snapshot.decisions.length > 0 ? (
            <View className="gap-2">
              <SectionTitle>Decisions</SectionTitle>
              {snapshot.decisions.slice(0, VISIBLE_DECISIONS).map((decision) => (
                <View key={decision.id} className="gap-0.5">
                  <Text className="text-sm text-foreground">{decision.text}</Text>
                  <Text className="text-xs text-foreground-muted">
                    {decision.sourceMessageId
                      ? `Source message ${shortId(decision.sourceMessageId)}`
                      : "No source message"}
                  </Text>
                </View>
              ))}
              {snapshot.decisions.length > VISIBLE_DECISIONS ? (
                <Text className="text-xs text-foreground-muted">
                  and {snapshot.decisions.length - VISIBLE_DECISIONS} more
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
});
