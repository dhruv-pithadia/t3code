#pragma once

#include <react/renderer/components/YantrixMarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/YantrixMarkdownTextSpec/Props.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/ShadowNode.h>

#include <string>
#include <vector>

namespace facebook::react {

extern const char YantrixMarkdownTextComponentName[];

struct YantrixMarkdownTextParagraphStyleRange {
  size_t location;
  size_t length;
  Float firstLineHeadIndent;
  Float headIndent;
  Float paragraphSpacing;
};

struct YantrixMarkdownTextAttachmentRange {
  size_t location;
  size_t length;
  std::string imageUri;
  /// Recolor the loaded image with the run's foreground color, like `sf:` symbols.
  bool tintWithForeground;
  Float chipWidth = 0;
  Float chipHeight = 0;
};

inline Float YantrixMarkdownTextAttachmentSize(const YantrixMarkdownTextAttachmentRange &) {
  return 14;
}

inline Float YantrixMarkdownTextAttachmentBaselineOffset(
    const YantrixMarkdownTextAttachmentRange &) {
  return -2;
}

class YantrixMarkdownTextStateReal final {
 public:
  AttributedString attributedString;
  std::vector<YantrixMarkdownTextParagraphStyleRange> paragraphStyleRanges;
  std::vector<YantrixMarkdownTextAttachmentRange> attachmentRanges;
};

class YantrixMarkdownTextShadowNode final : public ConcreteViewShadowNode<
YantrixMarkdownTextComponentName,
YantrixMarkdownTextProps,
YantrixMarkdownTextEventEmitter,
YantrixMarkdownTextStateReal> {
public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  YantrixMarkdownTextShadowNode(
   const ShadowNode& sourceShadowNode,
   const ShadowNodeFragment& fragment
  );

  static ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  void layout(LayoutContext layoutContext) override;

  Size measureContent(
      const LayoutContext& layoutContext,
      const LayoutConstraints& layoutConstraints) const override;

private:
  mutable AttributedString _attributedString;
  mutable std::vector<YantrixMarkdownTextParagraphStyleRange> _paragraphStyleRanges;
  mutable std::vector<YantrixMarkdownTextAttachmentRange> _attachmentRanges;
};
} // namespace facebook::React
