// Stub implementation - terminal package removed
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Event, Emitter } from '@theia/core/lib/common/event';
import { RPCProtocol } from '../common/rpc-protocol';
import { Disposable } from '../plugin/types-impl';
import { TerminalServiceExt } from '../common/plugin-api-rpc';
import { CancellationToken } from '@theia/core/lib/common/cancellation';

export class TerminalExtImpl {
    get name(): string { return ''; }
    get processId(): Promise<number | undefined> { return Promise.resolve(undefined); }
    get exitStatus(): any { return undefined; }
    get creationOptions(): any { return {}; }
    get state(): any { return { isInteractedWith: false }; }
    get shellIntegration(): any { return undefined; }
    sendText(text: string, addNewLine?: boolean): void { }
    show(preserveFocus?: boolean): void { }
    hide(): void { }
    dispose(): void { }
}

export class TerminalServiceExtImpl implements TerminalServiceExt {
    private readonly onDidOpenTerminalEmitter = new Emitter<any>();
    private readonly onDidCloseTerminalEmitter = new Emitter<any>();
    private readonly onDidChangeActiveTerminalEmitter = new Emitter<any>();
    private readonly onDidChangeTerminalStateEmitter = new Emitter<any>();
    private readonly onDidChangeShellEmitter = new Emitter<string>();

    readonly onDidOpenTerminal: Event<any> = this.onDidOpenTerminalEmitter.event;
    readonly onDidCloseTerminal: Event<any> = this.onDidCloseTerminalEmitter.event;
    readonly onDidChangeActiveTerminal: Event<any> = this.onDidChangeActiveTerminalEmitter.event;
    readonly onDidChangeTerminalState: Event<any> = this.onDidChangeTerminalStateEmitter.event;
    readonly onDidChangeShell: Event<string> = this.onDidChangeShellEmitter.event;

    get defaultShell(): string { return ''; }
    get activeTerminal(): TerminalExtImpl | undefined { return undefined; }
    get terminals(): TerminalExtImpl[] { return []; }

    constructor(protected readonly rpc: RPCProtocol) {
    }

    createTerminal(plugin: any, nameOrOptions?: any, shellPath?: string, shellArgs?: string[]): any {
        return new TerminalExtImpl();
    }

    attachPtyToTerminal(terminalId: number, pty: any): void { }
    registerTerminalLinkProvider(provider: any): Disposable { return Disposable.NULL; }
    registerTerminalProfileProvider(id: string, provider: any): Disposable { return Disposable.NULL; }
    registerTerminalQuickFixProvider(id: string, provider: any): Disposable { return Disposable.NULL; }
    registerTerminalObserver(observer: any): Disposable { return Disposable.NULL; }
    getEnvironmentVariableCollection(extensionIdentifier: string): any { return undefined; }

    $startProfile(providerId: string, cancellationToken: CancellationToken): Promise<string> { return Promise.resolve(''); }
    $terminalCreated(id: string, name: string): void { }
    $terminalNameChanged(id: string, name: string): void { }
    $terminalOpened(id: string, processId: number, terminalId: number, cols: number, rows: number): void { }
    $terminalClosed(id: string, exitStatus: any): void { }
    $terminalOnInput(id: string, data: string): void { }
    $terminalSizeChanged(id: string, cols: number, rows: number): void { }
    $currentTerminalChanged(id: string | undefined): void { }
    $terminalOnInteraction(id: string): void { }
    $terminalShellTypeChanged(id: string, newShellType: string): void { }
    $initEnvironmentVariableCollections(collections: any[]): void { }
    $provideTerminalLinks(line: string, terminalId: string, token: CancellationToken): Promise<any[]> { return Promise.resolve([]); }
    $handleTerminalLink(link: any): Promise<void> { return Promise.resolve(); }
    $setShell(shell: string): void { }
    $reportOutputMatch(observerId: string, groups: string[]): void { }
}

export class EnvironmentVariableCollectionImpl {
    readonly persistent: boolean;
    readonly map: Map<string, any> = new Map();
    readonly descriptionMap: Map<string, any> = new Map();
    description: string | any | undefined;

    constructor(persistent: boolean) {
        this.persistent = persistent;
    }

    get size(): number { return this.map.size; }
    replace(variable: string, value: string): void { }
    append(variable: string, value: string): void { }
    prepend(variable: string, value: string): void { }
    get(variable: string): any { return undefined; }
    forEach(callback: (variable: string, mutator: any, collection: any) => void): void { }
    clear(): void { this.map.clear(); }
    delete(variable: string): boolean { return this.map.delete(variable); }
    getScoped(scope: any): any { return new EnvironmentVariableCollectionImpl(this.persistent); }
}
