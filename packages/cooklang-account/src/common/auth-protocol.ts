// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

export const AuthServicePath = '/services/cooked-auth';
export const AuthService = Symbol('AuthService');

export interface AuthState {
    status: 'logged-out' | 'logged-in';
    email?: string;
}

export interface AuthData {
    token: string;
    email: string;
    expiresAt: string;
    createdAt: string;
}

export interface LoginResult {
    authUrl: string;
}

/**
 * RPC-safe interface for the auth service.
 *
 * NOTE: Do NOT add Event properties here. Properties starting with "on" are
 * treated as RPC notifications by Theia's proxy factory — the listener
 * function cannot be serialised, arrives as `undefined`, and corrupts the
 * backend emitter.  Backend services that need the auth-change event should
 * inject `AuthServiceBackend` instead.
 */
export interface AuthService {
    login(): Promise<LoginResult>;
    logout(): Promise<void>;
    getAuthState(): Promise<AuthState>;
    getToken(): Promise<string | undefined>;
}
