#pragma once

#include <react/renderer/components/YantrixMarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/YantrixMarkdownTextSpec/Props.h>
#include <react/renderer/components/YantrixMarkdownTextSpec/States.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

namespace facebook::react {
extern const char YantrixMarkdownTextRunComponentName[];

using YantrixMarkdownTextRunShadowNode = ConcreteViewShadowNode<
    YantrixMarkdownTextRunComponentName,
    YantrixMarkdownTextRunProps,
    YantrixMarkdownTextRunEventEmitter,
    YantrixMarkdownTextRunState>;
}
