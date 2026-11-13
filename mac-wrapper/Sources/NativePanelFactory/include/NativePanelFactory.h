#import <AppKit/AppKit.h>
NS_ASSUME_NONNULL_BEGIN
/// These functions catch only AppKit Objective-C exceptions, without unwinding Swift frames.
FOUNDATION_EXPORT NSOpenPanel * _Nullable AxonCreateOpenPanel(void);
FOUNDATION_EXPORT NSSavePanel * _Nullable AxonCreateSavePanel(void);
FOUNDATION_EXPORT BOOL AxonBeginPanelSheet(NSSavePanel *panel, NSWindow *window, void (^completion)(NSModalResponse));
FOUNDATION_EXPORT BOOL AxonBeginStandalonePanel(NSSavePanel *panel, void (^completion)(NSModalResponse));
FOUNDATION_EXPORT NSString *AxonPanelFailureMessage(void);
NS_ASSUME_NONNULL_END
