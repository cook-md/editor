// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

export const CookbotAuthServicePath = '/services/cookbot-auth';
export const CookbotAuthService = Symbol('CookbotAuthService');

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

export interface CookbotAuthService {
    login(): Promise<LoginResult>;
    logout(): Promise<void>;
    getAuthState(): Promise<AuthState>;
    getToken(): Promise<string | undefined>;
}
