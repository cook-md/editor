// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

export const AuthServicePath = '/services/cookmd-auth';
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
 * inject `AuthServiceImpl` directly.
 */
export interface AuthService {
    login(): Promise<LoginResult>;
    logout(): Promise<void>;
    getAuthState(): Promise<AuthState>;
    getToken(): Promise<string | undefined>;
}
