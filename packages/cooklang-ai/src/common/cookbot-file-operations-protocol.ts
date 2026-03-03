// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { RpcServer } from '@theia/core/lib/common/messaging/proxy-factory';

export const CookbotFileOperationsPath = '/services/cookbot-file-operations';
export const CookbotFileOperationsServer = Symbol('CookbotFileOperationsServer');

export interface CookbotFileOperationsServer extends RpcServer<CookbotFileOperationsClient> {
}

export interface CookbotFileOperationsClient {
    replaceText(relativePath: string, oldText: string, newText: string): Promise<string>;
    insertText(relativePath: string, line: number, text: string): Promise<string>;
}
