#import "NativePanelFactory.h"

static id CreatePanel(Class panelClass) {
    @try { return [[panelClass alloc] init]; }
    @catch (__unused NSException *exception) { return nil; }
}
NSOpenPanel *AxonCreateOpenPanel(void) { return CreatePanel(NSOpenPanel.class); }
NSSavePanel *AxonCreateSavePanel(void) { return CreatePanel(NSSavePanel.class); }
BOOL AxonBeginPanelSheet(NSSavePanel *panel, NSWindow *window, void (^completion)(NSModalResponse)) {
    @try {
        [panel beginSheetModalForWindow:window completionHandler:completion];
        return YES;
    } @catch (__unused NSException *exception) { return NO; }
}
NSString *AxonPanelFailureMessage(void) {
    return @"macOS could not open its file chooser. Your files have not changed. Close this message and try again. If it happens again, wait for macOS file locations to become available before retrying.";
}

BOOL AxonBeginStandalonePanel(NSSavePanel *panel, void (^completion)(NSModalResponse)) {
    @try { [panel beginWithCompletionHandler:completion]; return YES; }
    @catch (__unused NSException *exception) { return NO; }
}
