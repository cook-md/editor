// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { CookbotFileOperationsClient } from '../common/cookbot-file-operations-protocol';

@injectable()
export class CookbotFileOperationsClientImpl implements CookbotFileOperationsClient {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    async replaceText(relativePath: string, oldText: string, newText: string): Promise<string> {
        const uri = this.resolveUri(relativePath);
        const monacoEditor = await this.findMonacoEditor(uri);

        if (monacoEditor) {
            const model = monacoEditor.document.textEditorModel;
            const content = model.getValue();
            const offset = content.indexOf(oldText);
            if (offset === -1) {
                throw new Error('Pattern not found in file');
            }
            const startPos = model.getPositionAt(offset);
            const endPos = model.getPositionAt(offset + oldText.length);
            const range = {
                startLineNumber: startPos.lineNumber,
                startColumn: startPos.column,
                endLineNumber: endPos.lineNumber,
                endColumn: endPos.column,
            };
            model.pushStackElement();
            model.pushEditOperations([], [{ range, text: newText }], () => []);
            model.pushStackElement();
            return `Successfully replaced text in ${relativePath}`;
        }

        // File not open - fall back to FileService
        const fileContent = await this.fileService.read(uri);
        const content = fileContent.value;
        const idx = content.indexOf(oldText);
        if (idx === -1) {
            throw new Error('Pattern not found in file');
        }
        const updated = content.substring(0, idx) + newText + content.substring(idx + oldText.length);
        await this.fileService.write(uri, updated);
        return `Successfully replaced text in ${relativePath}`;
    }

    async insertText(relativePath: string, line: number, text: string): Promise<string> {
        const uri = this.resolveUri(relativePath);
        const monacoEditor = await this.findMonacoEditor(uri);

        if (monacoEditor) {
            const model = monacoEditor.document.textEditorModel;
            const lineCount = model.getLineCount();
            if (line > lineCount) {
                throw new Error(`insert_line ${line} exceeds file length ${lineCount} lines`);
            }

            let range;
            let insertText: string;
            if (line === 0) {
                range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
                insertText = text + '\n';
            } else {
                const lineLength = model.getLineLength(line);
                range = {
                    startLineNumber: line,
                    startColumn: lineLength + 1,
                    endLineNumber: line,
                    endColumn: lineLength + 1,
                };
                insertText = '\n' + text;
            }
            model.pushStackElement();
            model.pushEditOperations([], [{ range, text: insertText }], () => []);
            model.pushStackElement();
            return `Text inserted at line ${line} in file: ${relativePath}`;
        }

        // File not open - fall back to FileService
        const fileContent = await this.fileService.read(uri);
        const content = fileContent.value;
        const lines = content.split('\n');
        if (line > lines.length) {
            throw new Error(`insert_line ${line} exceeds file length ${lines.length} lines`);
        }
        let newContent: string;
        if (line === 0) {
            newContent = text + '\n' + content;
        } else {
            lines.splice(line, 0, text);
            newContent = lines.join('\n');
        }
        await this.fileService.write(uri, newContent);
        return `Text inserted at line ${line} in file: ${relativePath}`;
    }

    private resolveUri(relativePath: string): URI {
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            throw new Error('No workspace open');
        }
        return roots[0].resource.resolve(relativePath);
    }

    private async findMonacoEditor(uri: URI): Promise<MonacoEditor | undefined> {
        const editorWidget = await this.editorManager.getByUri(uri);
        if (editorWidget) {
            const editor = editorWidget.editor;
            if (editor instanceof MonacoEditor) {
                return editor;
            }
        }
        return undefined;
    }
}
