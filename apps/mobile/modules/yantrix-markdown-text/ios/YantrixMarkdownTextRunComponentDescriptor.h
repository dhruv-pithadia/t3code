#pragma once

#include "YantrixMarkdownTextRunShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {
using YantrixMarkdownTextRunComponentDescriptor = ConcreteComponentDescriptor<YantrixMarkdownTextRunShadowNode>;

void YantrixMarkdownTextRunSpec_registerComponentDescriptorsFromCodegen(
  std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
}
