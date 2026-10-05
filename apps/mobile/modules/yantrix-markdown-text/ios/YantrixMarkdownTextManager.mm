#import <React/RCTViewManager.h>
#import <React/RCTUIManager.h>
#import "Utils.h"

@interface YantrixMarkdownTextManager : RCTViewManager
@end

@implementation YantrixMarkdownTextManager

RCT_EXPORT_MODULE(YantrixMarkdownText)

- (UIView *)view
{
  return [[UIView alloc] init];
}

RCT_CUSTOM_VIEW_PROPERTY(color, NSString, UIView)
{
}

@end

@interface YantrixMarkdownTextRunManager : RCTViewManager
@end

@implementation YantrixMarkdownTextRunManager

RCT_EXPORT_MODULE(YantrixMarkdownTextRun)

- (UIView *)view
{
  return nil;
}

@end
