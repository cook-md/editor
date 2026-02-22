// Stub implementation - debug package removed
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Event, Emitter } from '@theia/core/lib/common/event';
import { RPCProtocol } from '../../common/rpc-protocol';
import { Disposable } from '../types-impl';
import { DebugExt } from '../../common/plugin-api-rpc';

export class DebugExtImpl implements DebugExt {
    private readonly onDidChangeActiveDebugSessionEmitter = new Emitter<any>();
    private readonly onDidStartDebugSessionEmitter = new Emitter<any>();
    private readonly onDidTerminateDebugSessionEmitter = new Emitter<any>();
    private readonly onDidReceiveDebugSessionCustomEventEmitter = new Emitter<any>();
    private readonly onDidChangeBreakpointsEmitter = new Emitter<any>();
    private readonly onDidChangeActiveStackItemEmitter = new Emitter<any>();

    readonly onDidChangeActiveDebugSession: Event<any> = this.onDidChangeActiveDebugSessionEmitter.event;
    readonly onDidStartDebugSession: Event<any> = this.onDidStartDebugSessionEmitter.event;
    readonly onDidTerminateDebugSession: Event<any> = this.onDidTerminateDebugSessionEmitter.event;
    readonly onDidReceiveDebugSessionCustomEvent: Event<any> = this.onDidReceiveDebugSessionCustomEventEmitter.event;
    readonly onDidChangeBreakpoints: Event<any> = this.onDidChangeBreakpointsEmitter.event;
    readonly onDidChangeActiveStackItem: Event<any> = this.onDidChangeActiveStackItemEmitter.event;

    get activeDebugSession(): any { return undefined; }
    get activeDebugConsole(): any { return { append() { }, appendLine() { } }; }
    get breakpoints(): any[] { return []; }
    get activeStackItem(): any { return undefined; }

    constructor(protected readonly rpc: RPCProtocol) {
    }

    assistedInject(connectionExt: any, commandRegistry: any): void { }
    registerDebuggersContributions(pluginFolder: string, type: string, contributions: any[]): void { }
    registerDebugAdapterDescriptorFactory(debugType: string, factory: any): Disposable { return Disposable.NULL; }
    registerDebugConfigurationProvider(debugType: string, provider: any, triggerKind: number): Disposable { return Disposable.NULL; }
    registerDebugAdapterTrackerFactory(debugType: string, factory: any): Disposable { return Disposable.NULL; }
    startDebugging(folder: any, nameOrConfiguration: any, options: any): Promise<boolean> { return Promise.resolve(false); }
    stopDebugging(session?: any): Promise<void> { return Promise.resolve(); }
    addBreakpoints(breakpoints: any[]): void { }
    removeBreakpoints(breakpoints: any[]): void { }
    asDebugSourceUri(src: any, session?: any): any { return undefined; }

    $onSessionCustomEvent(sessionId: string, event: string, body?: any): void { }
    $breakpointsDidChange(added: any[], removed: any[], changed: any[]): void { }
    $sessionDidCreate(sessionId: string): void { }
    $sessionDidStart(sessionId: string): void { }
    $sessionDidDestroy(sessionId: string): void { }
    $sessionDidChange(sessionId: string | undefined): void { }
    $provideDebugConfigurationsByHandle(handle: number, workspaceFolder: string | undefined): Promise<any[]> { return Promise.resolve([]); }
    $resolveDebugConfigurationByHandle(handle: number, workspaceFolder: string | undefined, debugConfiguration: any): Promise<any> {
        return Promise.resolve(debugConfiguration);
    }
    $resolveDebugConfigurationWithSubstitutedVariablesByHandle(handle: number, workspaceFolder: string | undefined, debugConfiguration: any): Promise<any> {
        return Promise.resolve(debugConfiguration);
    }
    $onDidChangeActiveFrame(frame: any): void { }
    $onDidChangeActiveThread(thread: any): void { }
    $createDebugSession(debugConfiguration: any, workspaceFolder: string | undefined): Promise<string> { return Promise.resolve(''); }
    $terminateDebugSession(sessionId: string): Promise<void> { return Promise.resolve(); }
    $getTerminalCreationOptions(args: any): Promise<any> { return Promise.resolve({}); }
    $onDebugStackItem(sessionId: string | undefined, threadId: number | undefined, frameId: number | undefined): void { }
}
