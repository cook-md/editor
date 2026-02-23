// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import {
    AbstractMessageReader,
    AbstractMessageWriter,
    DataCallback,
    Disposable,
    Message,
    MessageWriter,
    createMessageConnection,
    MessageConnection
} from 'vscode-languageserver-protocol/node';

/**
 * MessageReader that reads from the NAPI-RS LspServer.
 * Parses raw LSP protocol messages (Content-Length header + JSON body).
 */
export class NativeMessageReader extends AbstractMessageReader {
    private callback: DataCallback | undefined;
    private buffer = '';
    private running = false;

    constructor(private receiveFn: () => Promise<string | null>) {
        super();
    }

    listen(callback: DataCallback): Disposable {
        this.callback = callback;
        this.running = true;
        this.startReading();
        return Disposable.create(() => {
            this.running = false;
        });
    }

    private async startReading(): Promise<void> {
        while (this.running) {
            try {
                const chunk = await this.receiveFn();
                if (chunk === null) {
                    break;
                }
                this.buffer += chunk;
                this.processBuffer();
            } catch (error) {
                this.fireError(error as Error);
                break;
            }
        }
        this.fireClose();
    }

    private processBuffer(): void {
        while (true) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) {
                return;
            }

            const header = this.buffer.substring(0, headerEnd);
            const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
            if (!contentLengthMatch) {
                // Skip malformed header
                this.buffer = this.buffer.substring(headerEnd + 4);
                continue;
            }

            const contentLength = parseInt(contentLengthMatch[1], 10);
            const bodyStart = headerEnd + 4;
            const bodyEnd = bodyStart + contentLength;

            if (this.buffer.length < bodyEnd) {
                return; // Not enough data yet
            }

            const body = this.buffer.substring(bodyStart, bodyEnd);
            this.buffer = this.buffer.substring(bodyEnd);

            try {
                const message = JSON.parse(body) as Message;
                if (this.callback) {
                    this.callback(message);
                }
            } catch (e) {
                this.fireError(new Error(`Failed to parse LSP message: ${e}`));
            }
        }
    }
}

/**
 * MessageWriter that writes to the NAPI-RS LspServer.
 * Formats messages with Content-Length header.
 */
export class NativeMessageWriter extends AbstractMessageWriter implements MessageWriter {

    constructor(private sendFn: (msg: string) => void) {
        super();
    }

    async write(msg: Message): Promise<void> {
        const json = JSON.stringify(msg);
        const contentLength = Buffer.byteLength(json, 'utf-8');
        const header = `Content-Length: ${contentLength}\r\n\r\n`;
        this.sendFn(header + json);
    }

    end(): void {
        // Nothing to clean up
    }
}

/**
 * Create a standard LSP MessageConnection from the NAPI-RS LspServer.
 */
export function createNativeLspConnection(
    sendFn: (msg: string) => void,
    receiveFn: () => Promise<string | null>
): MessageConnection {
    const reader = new NativeMessageReader(receiveFn);
    const writer = new NativeMessageWriter(sendFn);
    return createMessageConnection(reader, writer);
}
