#include "YantrixMarkdownTextShadowNode.h"
#include "YantrixMarkdownTextRunShadowNode.h"
#import "YantrixContextChip.h"
#include <react/renderer/components/view/ViewShadowNode.h>
#import <react/renderer/textlayoutmanager/RCTAttributedTextUtils.h>

#include <algorithm>
#include <cmath>

namespace facebook::react {

static constexpr Float ParagraphStyleEncodingOffset = 1000;
static constexpr auto FileAttachmentNativeIdPrefix = "yantrix-file:";
static constexpr auto SkillAttachmentNativeIdPrefix = "yantrix-skill:";
static constexpr auto LinkAttachmentNativeIdPrefix = "yantrix-link:";

static void applyParagraphStyles(
    NSMutableAttributedString *attributedString,
    const std::vector<YantrixMarkdownTextParagraphStyleRange> &styleRanges)
{
  for (const auto &styleRange : styleRanges) {
    if (styleRange.length == 0 || styleRange.location >= attributedString.length) {
      continue;
    }

    const NSRange markerRange = NSMakeRange(
        styleRange.location,
        MIN(styleRange.length, attributedString.length - styleRange.location));
    const NSRange paragraphRange = [attributedString.string paragraphRangeForRange:markerRange];
    const NSParagraphStyle *existingStyle =
        [attributedString attribute:NSParagraphStyleAttributeName
                            atIndex:paragraphRange.location
                     effectiveRange:nil];
    NSMutableParagraphStyle *paragraphStyle =
        existingStyle ? [existingStyle mutableCopy] : [NSMutableParagraphStyle new];
    paragraphStyle.firstLineHeadIndent = styleRange.firstLineHeadIndent;
    paragraphStyle.headIndent = styleRange.headIndent;
    paragraphStyle.paragraphSpacing = styleRange.paragraphSpacing;
    paragraphStyle.tabStops = @[
      [[NSTextTab alloc] initWithTextAlignment:NSTextAlignmentLeft
                                      location:styleRange.headIndent
                                       options:@{}]
    ];
    paragraphStyle.defaultTabInterval = styleRange.headIndent;
    [attributedString addAttribute:NSParagraphStyleAttributeName
                             value:paragraphStyle
                             range:paragraphRange];
  }
}

static void applyAttachments(
    NSMutableAttributedString *attributedString,
    const std::vector<YantrixMarkdownTextAttachmentRange> &attachmentRanges)
{
  for (const auto &attachmentRange : attachmentRanges) {
    if (attachmentRange.length == 0 || attachmentRange.location >= attributedString.length) {
      continue;
    }

    NSTextAttachment *attachment = [[NSTextAttachment alloc] init];
    attachment.image = [[UIImage alloc] init];
    const CGFloat attachmentSize = YantrixMarkdownTextAttachmentSize(attachmentRange);
    attachment.bounds = CGRectMake(
        0,
        YantrixMarkdownTextAttachmentBaselineOffset(attachmentRange),
        attachmentSize,
        attachmentSize);
    NSDictionary *runAttributes =
        [attributedString attributesAtIndex:attachmentRange.location effectiveRange:nil];
    if (attachmentRange.chipWidth > 0) {
      attachment.bounds = YantrixContextChipBounds(
          runAttributes[NSFontAttributeName],
          CGSizeMake(attachmentRange.chipWidth, attachmentRange.chipHeight));
    }
    const NSRange range = NSMakeRange(
        attachmentRange.location,
        MIN(attachmentRange.length, attributedString.length - attachmentRange.location));
    [attributedString replaceCharactersInRange:range
                          withAttributedString:YantrixMarkdownTextAttachmentString(attachment, runAttributes)];
  }
}

YantrixMarkdownTextShadowNode::YantrixMarkdownTextShadowNode(
   const ShadowNode& sourceShadowNode,
   const ShadowNodeFragment& fragment
) : ConcreteViewShadowNode(sourceShadowNode, fragment) {
};

Size YantrixMarkdownTextShadowNode::measureContent(
  const LayoutContext& layoutContext,
  const LayoutConstraints& layoutConstraints) const {
    const auto &baseProps = getConcreteProps();

    auto baseTextAttributes = TextAttributes::defaultTextAttributes();
    baseTextAttributes.backgroundColor = baseProps.backgroundColor;
    baseTextAttributes.allowFontScaling = baseProps.allowFontScaling;

    Float fontSizeMultiplier = 1.0;
    if (baseTextAttributes.allowFontScaling) {
      fontSizeMultiplier = layoutContext.fontSizeMultiplier;
    }

    auto baseAttributedString = AttributedString{};
    auto paragraphStyleRanges = std::vector<YantrixMarkdownTextParagraphStyleRange>{};
    auto attachmentRanges = std::vector<YantrixMarkdownTextAttachmentRange>{};
    size_t utf16Offset = 0;
    const auto &children = getChildren();
    for (size_t i = 0; i < children.size(); i++) {
      const auto child = children[i].get();
      if (auto textViewChild = dynamic_cast<const YantrixMarkdownTextRunShadowNode *>(child)) {
        auto &props = textViewChild->getConcreteProps();
        auto fragment = AttributedString::Fragment{};
        auto textAttributes = TextAttributes::defaultTextAttributes();

        textAttributes.allowFontScaling = baseProps.allowFontScaling;
        textAttributes.backgroundColor = props.backgroundColor;
        textAttributes.fontSize = props.fontSize * fontSizeMultiplier;
        textAttributes.lineHeight = props.lineHeight * fontSizeMultiplier;
        textAttributes.foregroundColor = props.color;
        const bool hasParagraphStyle = props.shadowRadius >= ParagraphStyleEncodingOffset;
        if (!hasParagraphStyle) {
          textAttributes.textShadowColor = props.shadowColor;
          textAttributes.textShadowOffset = props.shadowOffset;
          textAttributes.textShadowRadius = props.shadowRadius;
        }
        textAttributes.letterSpacing = props.letterSpacing;
        textAttributes.textDecorationColor = props.textDecorationColor;
        textAttributes.fontFamily = props.fontFamily;

        if (props.fontStyle == YantrixMarkdownTextRunFontStyle::Italic) {
          textAttributes.fontStyle = FontStyle::Italic;
        } else {
          textAttributes.fontStyle = FontStyle::Normal;
        }

        if (props.fontWeight == YantrixMarkdownTextRunFontWeight::Bold) {
          textAttributes.fontWeight = FontWeight::Bold;
        } else if (props.fontWeight == YantrixMarkdownTextRunFontWeight::UltraLight) {
          textAttributes.fontWeight = FontWeight::UltraLight;
        } else if (props.fontWeight == YantrixMarkdownTextRunFontWeight::Light) {
          textAttributes.fontWeight = FontWeight::Light;
        } else if (props.fontWeight == YantrixMarkdownTextRunFontWeight::Medium) {
          textAttributes.fontWeight = FontWeight::Medium;
        } else if (props.fontWeight == YantrixMarkdownTextRunFontWeight::Semibold) {
          textAttributes.fontWeight = FontWeight::Semibold;
        } else if (props.fontWeight == YantrixMarkdownTextRunFontWeight::Heavy) {
          textAttributes.fontWeight = FontWeight::Heavy;
        } else {
          textAttributes.fontWeight = FontWeight::Regular;
        }

        if (props.textDecorationLine == YantrixMarkdownTextRunTextDecorationLine::LineThrough) {
          textAttributes.textDecorationLineType = TextDecorationLineType::Strikethrough;
        } else if (props.textDecorationLine == YantrixMarkdownTextRunTextDecorationLine::Underline) {
          textAttributes.textDecorationLineType = TextDecorationLineType::Underline;
        } else {
          textAttributes.textDecorationLineType = TextDecorationLineType::None;
        }

        if (props.textDecorationStyle == YantrixMarkdownTextRunTextDecorationStyle::Solid) {
          textAttributes.textDecorationStyle = TextDecorationStyle::Solid;
        } else if (props.textDecorationStyle == YantrixMarkdownTextRunTextDecorationStyle::Dotted) {
          textAttributes.textDecorationStyle = TextDecorationStyle::Dotted;
        } else if (props.textDecorationStyle == YantrixMarkdownTextRunTextDecorationStyle::Dashed) {
          textAttributes.textDecorationStyle = TextDecorationStyle::Dashed;
        } else if (props.textDecorationStyle == YantrixMarkdownTextRunTextDecorationStyle::Double) {
          textAttributes.textDecorationStyle = TextDecorationStyle::Double;
        }

        if (props.textAlign == YantrixMarkdownTextRunTextAlign::Left) {
          textAttributes.alignment = TextAlignment::Left;
        } else if (props.textAlign == YantrixMarkdownTextRunTextAlign::Right) {
          textAttributes.alignment = TextAlignment::Right;
        } else if (props.textAlign == YantrixMarkdownTextRunTextAlign::Center) {
          textAttributes.alignment = TextAlignment::Center;
        } else if (props.textAlign == YantrixMarkdownTextRunTextAlign::Justify) {
          textAttributes.alignment = TextAlignment::Justified;
        } else if (props.textAlign == YantrixMarkdownTextRunTextAlign::Auto) {
          textAttributes.alignment = TextAlignment::Natural;
        }

        textAttributes.backgroundColor = props.backgroundColor;

        fragment.string = props.text;
        fragment.textAttributes = textAttributes;

        NSString *fragmentText = [NSString stringWithUTF8String:props.text.c_str()];
        const size_t fragmentLength = fragmentText.length;
        if (hasParagraphStyle) {
          paragraphStyleRanges.push_back(YantrixMarkdownTextParagraphStyleRange{
              utf16Offset,
              fragmentLength,
              props.shadowOffset.width,
              props.shadowOffset.height,
              props.shadowRadius - ParagraphStyleEncodingOffset,
          });
        }
        if (props.nativeId.rfind("yantrix-chip:", 0) == 0 && fragmentLength > 0) {
          const std::string uri = props.nativeId.substr(3);
          NSMutableDictionary *payload =
              [YantrixContextChipPayload([NSString stringWithUTF8String:uri.c_str()]) mutableCopy];
          // Chips must scale with the paragraph or smaller Dynamic Type sizes clip them.
          // Store the scaled payload so measurement and the rendered bitmap use the same font.
          payload[@"fontSizeMultiplier"] = @(fontSizeMultiplier);
          NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
          NSString *scaledUri = [@"chip:" stringByAppendingString:
              [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
          const CGFloat maxWidth = std::isfinite(layoutConstraints.maximumSize.width)
              ? layoutConstraints.maximumSize.width : 320;
          const CGSize size = YantrixContextChipSize(payload, maxWidth);
          attachmentRanges.push_back(YantrixMarkdownTextAttachmentRange{
              utf16Offset, 1, std::string(scaledUri.UTF8String), false,
              static_cast<Float>(size.width), static_cast<Float>(size.height),
          });
        } else if (props.nativeId.rfind(FileAttachmentNativeIdPrefix, 0) == 0 && fragmentLength > 0) {
          attachmentRanges.push_back(YantrixMarkdownTextAttachmentRange{
              utf16Offset,
              1,
              props.nativeId.substr(std::char_traits<char>::length(FileAttachmentNativeIdPrefix)),
              false,
          });
        } else if (
            props.nativeId.rfind(SkillAttachmentNativeIdPrefix, 0) == 0 && fragmentLength > 0) {
          attachmentRanges.push_back(YantrixMarkdownTextAttachmentRange{
              utf16Offset,
              1,
              props.nativeId.substr(
                  std::char_traits<char>::length(SkillAttachmentNativeIdPrefix)),
              false,
          });
        } else if (
            props.nativeId.rfind(LinkAttachmentNativeIdPrefix, 0) == 0 && fragmentLength > 0) {
          attachmentRanges.push_back(YantrixMarkdownTextAttachmentRange{
              utf16Offset,
              1,
              props.nativeId.substr(std::char_traits<char>::length(LinkAttachmentNativeIdPrefix)),
              true,
          });
        }
        utf16Offset += fragmentLength;
        baseAttributedString.appendFragment(std::move(fragment));
      }
    }

    _attributedString = baseAttributedString;
    _paragraphStyleRanges = paragraphStyleRanges;
    _attachmentRanges = attachmentRanges;

    NSMutableAttributedString *convertedAttributedString =
        [RCTNSAttributedStringFromAttributedString(baseAttributedString) mutableCopy];
    applyParagraphStyles(convertedAttributedString, paragraphStyleRanges);
    applyAttachments(convertedAttributedString, attachmentRanges);
    // TextKit stacks a paragraph's extra line height above the glyphs. React Native's own
    // layout manager centres them with a baseline offset; do the same, after attachments
    // so chips shift with the words.
    RCTApplyBaselineOffset(convertedAttributedString);

    const CGFloat maximumWidth = std::isfinite(layoutConstraints.maximumSize.width)
        ? layoutConstraints.maximumSize.width
        : CGFLOAT_MAX;
    NSTextStorage *textStorage =
        [[NSTextStorage alloc] initWithAttributedString:convertedAttributedString];
    NSLayoutManager *layoutManager = [[NSLayoutManager alloc] init];
    layoutManager.usesFontLeading = NO;
    NSTextContainer *textContainer =
        [[NSTextContainer alloc] initWithSize:CGSizeMake(maximumWidth, CGFLOAT_MAX)];
    textContainer.lineFragmentPadding = 0;
    textContainer.maximumNumberOfLines = baseProps.numberOfLines;
    if (baseProps.ellipsizeMode == YantrixMarkdownTextEllipsizeMode::Head) {
      textContainer.lineBreakMode = NSLineBreakByTruncatingHead;
    } else if (baseProps.ellipsizeMode == YantrixMarkdownTextEllipsizeMode::Middle) {
      textContainer.lineBreakMode = NSLineBreakByTruncatingMiddle;
    } else if (baseProps.ellipsizeMode == YantrixMarkdownTextEllipsizeMode::Tail) {
      textContainer.lineBreakMode = NSLineBreakByTruncatingTail;
    } else {
      textContainer.lineBreakMode = NSLineBreakByClipping;
    }
    [layoutManager addTextContainer:textContainer];
    [textStorage addLayoutManager:layoutManager];
    [layoutManager ensureLayoutForTextContainer:textContainer];
    const CGRect usedRect = [layoutManager usedRectForTextContainer:textContainer];

    return {
        std::clamp(
            static_cast<Float>(std::ceil(usedRect.size.width)),
            layoutConstraints.minimumSize.width,
            layoutConstraints.maximumSize.width),
        std::clamp(
            static_cast<Float>(std::ceil(usedRect.size.height)),
            layoutConstraints.minimumSize.height,
            layoutConstraints.maximumSize.height),
    };
}

void YantrixMarkdownTextShadowNode::layout(LayoutContext layoutContext) {
  ensureUnsealed();
  setStateData(YantrixMarkdownTextStateReal{
    _attributedString,
    _paragraphStyleRanges,
    _attachmentRanges,
  });
}
}
