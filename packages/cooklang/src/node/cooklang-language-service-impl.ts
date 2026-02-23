// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { createNativeLspConnection } from './cooklang-language-server-connection';
import { MessageConnection } from 'vscode-languageserver-protocol/node';

@injectable()
export class CooklangLanguageServiceImpl implements CooklangLanguageService {

    private connection: MessageConnection | undefined;
    private nativeLsp: any;

    @postConstruct()
    protected init(): void {
        try {
            // Dynamic import of native addon - it may not be built yet
            const native = require('@theia/cooklang-native');
            if (native && native.LspServer) {
                this.nativeLsp = new native.LspServer();
                this.connection = createNativeLspConnection(
                    (msg: string) => this.nativeLsp.sendMessage(msg),
                    () => this.nativeLsp.receiveMessage()
                );
                this.connection.listen();
                console.info('Cooklang LSP server started in-process');
            }
        } catch (error) {
            console.warn('Cooklang native addon not available, LSP features disabled:', error);
        }
    }

    async initialize(rootUri: string | null): Promise<void> {
        if (!this.connection) {
            return;
        }
        await this.connection.sendRequest('initialize', {
            processId: process.pid,
            capabilities: {},
            rootUri,
            workspaceFolders: rootUri ? [{ uri: rootUri, name: 'workspace' }] : null,
        });
        await this.connection.sendNotification('initialized');
    }

    async shutdown(): Promise<void> {
        if (!this.connection) {
            return;
        }
        await this.connection.sendRequest('shutdown');
        this.connection.sendNotification('exit');
        this.connection.dispose();
    }
}
