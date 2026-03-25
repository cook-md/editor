import { Event } from '@theia/core/lib/common';

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

export interface AuthService {
    login(): Promise<LoginResult>;
    logout(): Promise<void>;
    getAuthState(): Promise<AuthState>;
    getToken(): Promise<string | undefined>;
    readonly onDidChangeAuth: Event<AuthState>;
}
