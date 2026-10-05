#pragma once

#include "YantrixMarkdownTextShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {
using YantrixMarkdownTextComponentDescriptor = ConcreteComponentDescriptor<YantrixMarkdownTextShadowNode>;

void YantrixMarkdownTextSpec_registerComponentDescriptorsFromCodegen(
  std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
}
