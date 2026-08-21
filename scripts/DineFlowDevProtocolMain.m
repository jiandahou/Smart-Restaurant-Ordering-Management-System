#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>

@interface DineFlowDevProtocolDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, assign) BOOL handledURL;
@end

@implementation DineFlowDevProtocolDelegate

- (void)applicationWillFinishLaunching:(NSNotification *)notification {
    [[NSAppleEventManager sharedAppleEventManager]
        setEventHandler:self
             andSelector:@selector(handleGetURLEvent:withReplyEvent:)
           forEventClass:kInternetEventClass
              andEventID:kAEGetURL];
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (!self.handledURL) {
            [NSApp terminate:nil];
        }
    });
}

- (void)handleGetURLEvent:(NSAppleEventDescriptor *)event
           withReplyEvent:(NSAppleEventDescriptor *)replyEvent {
    if (self.handledURL) {
        return;
    }

    NSString *uri = [[event paramDescriptorForKeyword:keyDirectObject] stringValue];
    if (uri.length == 0) {
        return;
    }

    self.handledURL = YES;

    NSURL *resourcesURL = [[NSBundle mainBundle] resourceURL];
    NSURL *handlerURL = [resourcesURL URLByAppendingPathComponent:@"dineflow-dev-protocol-macos.sh"];
    NSURL *repositoryRootURL = [resourcesURL URLByAppendingPathComponent:@"repository-root"];
    NSError *error = nil;
    NSString *repositoryRoot = [NSString stringWithContentsOfURL:repositoryRootURL
                                                        encoding:NSUTF8StringEncoding
                                                           error:&error];
    repositoryRoot = [repositoryRoot stringByTrimmingCharactersInSet:
        [NSCharacterSet whitespaceAndNewlineCharacterSet]];

    if (error == nil) {
        NSMutableDictionary<NSString *, NSString *> *environment =
            [[[NSProcessInfo processInfo] environment] mutableCopy];
        environment[@"DINEFLOW_REPOSITORY_ROOT"] = repositoryRoot;

        NSTask *task = [[NSTask alloc] init];
        task.executableURL = handlerURL;
        task.arguments = @[uri];
        task.environment = environment;

        if ([task launchAndReturnError:&error]) {
            [task waitUntilExit];
        }
    }

    if (error != nil) {
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"Could not open Stripe Terminal";
        alert.informativeText = error.localizedDescription;
        [alert runModal];
    }

    [NSApp terminate:nil];
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        DineFlowDevProtocolDelegate *delegate = [[DineFlowDevProtocolDelegate alloc] init];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [application run];
    }
    return 0;
}
