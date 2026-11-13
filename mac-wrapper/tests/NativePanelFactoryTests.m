// Include the implementation to exercise its private constructor helper without exporting a production fault switch.
#import "../Sources/NativePanelFactory/NativePanelFactory.m"
@interface ThrowingPanel : NSObject
@end
@implementation ThrowingPanel
- (instancetype)init { [NSException raise:@"SyntheticPanelFailure" format:@"private-synthetic-path"]; return nil; }
@end
@interface ThrowingSheet : NSObject
@end
@implementation ThrowingSheet
- (void)beginWithCompletionHandler:(void (^)(NSModalResponse))completion { [NSException raise:@"SyntheticStandaloneFailure" format:@"private-synthetic-path"]; }
- (void)beginSheetModalForWindow:(NSWindow *)window completionHandler:(void (^)(NSModalResponse))completion {
    [NSException raise:@"SyntheticSheetFailure" format:@"private-synthetic-path"];
}
@end
int main(void) {
    @autoreleasepool {
        NSCAssert(CreatePanel(ThrowingPanel.class) == nil, @"constructor exception must return nil");
        NSCAssert(CreatePanel(NSObject.class) != nil, @"next construction succeeds after failure");
        __block int replies = 0;
        BOOL started = AxonBeginPanelSheet((NSSavePanel *)[ThrowingSheet new], (NSWindow *)[NSObject new], ^(NSModalResponse response) { replies++; });
        NSCAssert(!started && replies == 0, @"failed begin leaves cancellation settlement to Swift");
        NSCAssert(!AxonBeginStandalonePanel((NSSavePanel *)[ThrowingSheet new], ^(NSModalResponse response) { replies++; }) && replies == 0, @"standalone helper exception is bounded");
        NSCAssert(![AxonPanelFailureMessage() containsString:@"private-synthetic-path"], @"message is sanitized");
        puts("PASS: constructor exception, recovery, sheet exception and sanitized guidance; no OS panel created");
    }
    return 0;
}
