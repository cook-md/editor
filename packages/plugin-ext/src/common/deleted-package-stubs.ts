// *****************************************************************************
// Stub type definitions for types previously imported from deleted packages.
// These minimal stubs allow plugin-ext to compile without the actual packages.
// *****************************************************************************

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- @theia/debug stubs ---

export interface DebuggerDescription {
    type: string;
    label: string;
}

export interface DebugConfiguration {
    type: string;
    name: string;
    request: string;
    [key: string]: any;
}

export interface DebugSessionOptions {
    noDebug?: boolean;
    parentSession?: { id: string };
    lifecycleManagedByParent?: boolean;
    compact?: boolean;
    suppressDebugToolbar?: boolean;
    suppressDebugStatusbar?: boolean;
    suppressDebugView?: boolean;
    suppressSaveBeforeStart?: boolean;
    testRun?: any;
    [key: string]: any;
}

export interface DebugAdapter {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onMessage: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send(message: any): void;
    dispose(): void;
}

// --- @theia/timeline stubs ---

export interface InternalTimelineOptions {
    cacheResults?: boolean;
    resetCache?: boolean;
}

export interface Timeline {
    source: string;
    items: any[];
    paging?: any;
}

export interface TimelineChangeEvent {
    id: string;
    uri?: any;
    reset?: boolean;
}

export interface TimelineProviderDescriptor {
    id: string;
    label: string;
    scheme: string | string[];
}

// --- @theia/terminal stubs ---

export interface SerializableEnvironmentVariableCollection {
    [variable: string]: any;
}

// --- @theia/test stubs ---

export interface TreeDelta<TId, TItem> {
    path: TId[];
    type: 'added' | 'removed' | 'changed';
    item?: TItem;
    childDeltas?: TreeDelta<TId, TItem>[];
}

export interface ObservableCollection<TId, TItem> {
    get(id: TId): TItem | undefined;
    has(id: TId): boolean;
    values(): IterableIterator<TItem>;
    entries(): IterableIterator<[TId, TItem]>;
    readonly size: number;
}

// --- @theia/notebook stubs ---

export namespace notebookCommon {
    export type NotebookCellMetadata = Record<string, any>;
    export type NotebookCellInternalMetadata = Record<string, any>;
    export type NotebookDocumentMetadata = Record<string, any>;

    export enum CellKind {
        Markup = 1,
        Code = 2
    }

    export enum CellEditType {
        Replace = 1,
        Output = 2,
        Metadata = 3,
        CellLanguage = 4,
        DocumentMetadata = 5,
        OutputItems = 6,
        Move = 7,
        PartialInternalMetadata = 8
    }

    export enum CellStatusbarAlignment {
        Left = 1,
        Right = 2
    }

    export enum NotebookCellsChangeType {
        ModelChange = 1,
        Move = 2,
        Output = 3,
        OutputItem = 4,
        ChangeDocumentMetadata = 5,
        ChangeLanguage = 6,
        ChangeCellMetadata = 7,
        ChangeCellInternalMetadata = 8,
        ChangeCellContent = 9
    }

    export interface NotebookCellTextModelSplice<T> {
        start: number;
        deleteCount: number;
        newItems: T[];
    }

    export interface NotebookCellStatusBarItem {
        text: string;
        alignment: CellStatusbarAlignment;
        command?: any;
        tooltip?: any;
        priority?: number;
    }

    export interface TransientOptions {
        transientOutputs: boolean;
        transientCellMetadata: Record<string, boolean | undefined>;
        transientDocumentMetadata: Record<string, boolean | undefined>;
    }

    export interface NotebookCellsChangeLanguageEvent {
        readonly kind: NotebookCellsChangeType.ChangeLanguage;
        readonly index: number;
        readonly language: string;
    }

    export interface NotebookCellsChangeMetadataEvent {
        readonly kind: NotebookCellsChangeType.ChangeCellMetadata;
        readonly index: number;
        readonly metadata: NotebookCellMetadata;
    }

    export interface NotebookCellsChangeInternalMetadataEvent {
        readonly kind: NotebookCellsChangeType.ChangeCellInternalMetadata;
        readonly index: number;
        readonly internalMetadata: NotebookCellInternalMetadata;
    }

    export interface NotebookCellContentChangeEvent {
        readonly kind: NotebookCellsChangeType.ChangeCellContent;
    }

    export interface NotebookCellsInitializeEvent<T> {
        readonly kind: 'initialize';
        readonly changes: NotebookCellTextModelSplice<T>[];
    }

    export interface NotebookData {
        cells: any[];
        metadata?: NotebookDocumentMetadata;
    }

    export enum CellOutputKind {
        Text = 1,
        Error = 2,
        Rich = 3
    }

    export interface CellOutput {
        outputId: string;
        outputs: any[];
        metadata?: Record<string, any>;
    }
}

export enum CellExecutionUpdateType {
    Output = 1,
    OutputItems = 2,
    ExecutionState = 3
}

export interface CellRange {
    start: number;
    end: number;
}

export enum NotebookCellExecutionState {
    Unconfirmed = 1,
    Pending = 2,
    Executing = 3
}

// Top-level re-exports of notebook types used directly (not via notebookCommon namespace)
export enum CellEditType {
    Replace = 1,
    Output = 2,
    Metadata = 3,
    CellLanguage = 4,
    DocumentMetadata = 5,
    OutputItems = 6,
    Move = 7,
    PartialInternalMetadata = 8
}

export enum CellStatusbarAlignment {
    Left = 1,
    Right = 2
}

export type NotebookCellMetadata = Record<string, any>;
export type NotebookCellInternalMetadata = Record<string, any>;
export type NotebookDocumentMetadata = Record<string, any>;

export interface CellMetadataEdit {
    editType: CellEditType.Metadata;
    index: number;
    metadata: NotebookCellMetadata;
}

export interface NotebookDocumentMetadataEdit {
    editType: CellEditType.DocumentMetadata;
    metadata: NotebookDocumentMetadata;
}

export function isTextStreamMime(mimeType: string): boolean {
    return ['application/vnd.code.notebook.stdout', 'application/vnd.code.notebook.stderr'].includes(mimeType);
}

// --- @theia/callhierarchy / @theia/typehierarchy stubs ---

export interface CallHierarchyService {
    [key: string]: any;
}
export interface CallHierarchyServiceProvider {
    [key: string]: any;
}
export interface TypeHierarchyService {
    [key: string]: any;
}
export interface TypeHierarchyServiceProvider {
    [key: string]: any;
}

// --- @theia/ai-mcp stubs ---

export const MCPServerManager = Symbol('MCPServerManager');
export interface MCPServerManager {
    addOrUpdateServer(server: MCPServerDescription): void;
    removeServer(name: string): void;
    [key: string]: any;
}

export interface MCPServerDescription {
    name: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    autostart?: boolean;
    resolve?(description: MCPServerDescription): Promise<MCPServerDescription>;
    [key: string]: any;
}

export interface RemoteMCPServerDescription extends MCPServerDescription {
    serverUrl: string;
    headers?: Record<string, string>;
}

// --- @theia/task stubs ---

export interface ProblemMatcherContribution {
    name?: string;
    label?: string;
    owner?: string;
    source?: string;
    severity?: any;
    fileLocation?: string | string[];
    pattern?: any;
    background?: any;
    applyTo?: string;
}

export interface ProblemPatternContribution {
    name?: string;
    regexp?: string;
    file?: number;
    message?: number;
    location?: number;
    line?: number;
    character?: number;
    endLine?: number;
    endCharacter?: number;
    code?: number;
    severity?: number;
    loop?: boolean;
}

export interface TaskDefinition {
    taskType: string;
    source?: string;
    properties?: { [name: string]: any };
}
