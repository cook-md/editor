// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { AuthService, AuthData, AuthState, LoginResult } from '../common/auth-protocol';

const CALLBACK_PORT_START = 19285;
const CALLBACK_PORT_RETRIES = 10;
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Node-only extension of AuthService that exposes the auth-change event.
 * Backend services should inject this symbol instead of AuthService when
 * they need to react to auth state changes.
 */
export const AuthServiceBackend = Symbol('AuthServiceBackend');
export interface AuthServiceBackend extends AuthService {
    readonly onDidChangeAuth: Event<AuthState>;
}

@injectable()
export class AuthServiceImpl implements AuthServiceBackend {

    private authData: AuthData | undefined;
    private authDataLoaded = false;
    private callbackServer: http.Server | undefined;
    private callbackTimeout: ReturnType<typeof setTimeout> | undefined;

    private readonly onDidChangeAuthEmitter = new Emitter<AuthState>();
    readonly onDidChangeAuth: Event<AuthState> = this.onDidChangeAuthEmitter.event;

    @postConstruct()
    protected init(): void {
        this.loadFromDisk().then(() => {
            if (this.authData) {
                this.tryRenewToken();
            }
        });
        this.startRenewalTimer();
    }

    async login(): Promise<LoginResult> {
        this.cleanupCallbackServer();

        const state = crypto.randomUUID();
        const port = await this.startCallbackServer(state);
        const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
        const authUrl = `${webBaseUrl}/auth/desktops?callback=http://localhost:${port}/callback&state=${state}&app=editor`;

        return { authUrl };
    }

    async logout(): Promise<void> {
        this.cleanupCallbackServer();
        this.authData = undefined;
        this.authDataLoaded = false;

        const authFilePath = this.getAuthFilePath();
        try {
            await fs.promises.unlink(authFilePath);
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn('Failed to remove auth file:', (err as Error).message);
            }
        }

        this.onDidChangeAuthEmitter.fire({ status: 'logged-out' });
    }

    async getToken(): Promise<string | undefined> {
        if (!this.authDataLoaded) {
            await this.loadFromDisk();
        }
        return this.authData?.token;
    }

    async getAuthState(): Promise<AuthState> {
        if (!this.authDataLoaded) {
            await this.loadFromDisk();
        }
        if (this.authData) {
            return { status: 'logged-in', email: this.authData.email };
        }
        return { status: 'logged-out' };
    }

    private async startCallbackServer(expectedState: string): Promise<number> {
        this.callbackServer = http.createServer((req, res) => {
            const url = new URL(req.url || '/', 'http://localhost');

            if (url.pathname !== '/callback') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
                return;
            }

            const receivedState = url.searchParams.get('state');
            if (receivedState !== expectedState) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end('<html><body><h1>Error</h1><p>State mismatch. Please try logging in again.</p></body></html>');
                this.cleanupCallbackServer();
                return;
            }

            const token = url.searchParams.get('token');
            if (!token) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end('<html><body><h1>Error</h1><p>No token received. Please try logging in again.</p></body></html>');
                this.cleanupCallbackServer();
                return;
            }

            const { email, exp } = this.parseJwtPayload(token);
            const authData: AuthData = {
                token,
                email: email || '',
                expiresAt: exp ? new Date(exp * 1000).toISOString() : '',
                createdAt: new Date().toISOString()
            };

            this.saveToDisk(authData).then(() => {
                this.authData = authData;

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`<html><head><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f0eb; color: #333; }
.container { text-align: center; }
h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; }
p { color: #666; }
</style></head><body><div class="container"><h1>Login successful!</h1><p>You can close this tab and return to the editor.</p></div></body></html>`);
                this.cleanupCallbackServer();
                this.onDidChangeAuthEmitter.fire({ status: 'logged-in', email: authData.email });
            }).catch(() => {
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end(`<html><head><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f0eb; color: #333; }
.container { text-align: center; }
h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; color: #c44; }
p { color: #666; }
</style></head><body><div class="container"><h1>Error</h1><p>Failed to save authentication data. Please try again.</p></div></body></html>`);
                this.cleanupCallbackServer();
            });
        });

        const port = await this.listenOnAvailablePort(this.callbackServer);

        this.callbackTimeout = setTimeout(() => {
            this.cleanupCallbackServer();
        }, CALLBACK_TIMEOUT_MS);

        return port;
    }

    private listenOnAvailablePort(server: http.Server): Promise<number> {
        return new Promise((resolve, reject) => {
            let attempt = 0;

            const tryPort = (port: number): void => {
                const onError = (err: NodeJS.ErrnoException): void => {
                    server.removeListener('error', onError);
                    if (err.code === 'EADDRINUSE' && attempt < CALLBACK_PORT_RETRIES) {
                        attempt++;
                        tryPort(port + 1);
                    } else {
                        reject(new Error(`Failed to start auth callback server: ${err.message}`));
                    }
                };

                server.once('error', onError);
                server.listen(port, '127.0.0.1', () => {
                    server.removeListener('error', onError);
                    resolve(port);
                });
            };

            tryPort(CALLBACK_PORT_START);
        });
    }

    private cleanupCallbackServer(): void {
        if (this.callbackTimeout) {
            clearTimeout(this.callbackTimeout);
            this.callbackTimeout = undefined;
        }
        if (this.callbackServer) {
            this.callbackServer.close();
            this.callbackServer = undefined;
        }
    }

    private async tryRenewToken(): Promise<void> {
        if (!this.authData) {
            return;
        }
        try {
            const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
            const url = new URL('/api/sessions/renew', webBaseUrl);
            const response = await this.httpPost(url, this.authData.token);
            const data = JSON.parse(response);
            if (data.token) {
                const { email, exp } = this.parseJwtPayload(data.token);
                const renewed: AuthData = {
                    token: data.token,
                    email: email || this.authData.email,
                    expiresAt: exp ? new Date(exp * 1000).toISOString() : this.authData.expiresAt,
                    createdAt: this.authData.createdAt,
                };
                await this.saveToDisk(renewed);
                this.authData = renewed;
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('status 401') || message.includes('status 403')) {
                console.warn('Token renewal returned auth error, clearing session');
                await this.logout();
            } else {
                console.warn('Token renewal failed (will retry later):', message);
            }
        }
    }

    private startRenewalTimer(): void {
        // Singleton — runs for the app lifetime, no need to store the handle
        setInterval(async () => {
            if (this.authData) {
                await this.tryRenewToken();
            }
        }, RENEWAL_INTERVAL_MS);
    }

    private httpPost(url: URL, bearerToken: string): Promise<string> {
        const lib = url.protocol === 'https:' ? https : http;
        return new Promise((resolve, reject) => {
            const req = lib.request(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${bearerToken}`,
                    'Content-Type': 'application/json',
                },
            }, (res: http.IncomingMessage) => {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(body);
                    } else {
                        reject(new Error(`Renewal request failed with status ${res.statusCode}`));
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }

    private async loadFromDisk(): Promise<void> {
        try {
            const content = await fs.promises.readFile(this.getAuthFilePath(), 'utf8');
            const data = JSON.parse(content) as AuthData;
            if (data.token) {
                this.authData = data;
            }
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                // File exists but is corrupted — delete it
                try {
                    await fs.promises.unlink(this.getAuthFilePath());
                } catch {
                    // Ignore delete failure
                }
            }
        }
        this.authDataLoaded = true;
    }

    private async saveToDisk(data: AuthData): Promise<void> {
        const filePath = this.getAuthFilePath();
        const dir = path.dirname(filePath);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(filePath, JSON.stringify(data, undefined, 2), 'utf8');
        await fs.promises.chmod(filePath, 0o600);
    }

    private parseJwtPayload(token: string): { email?: string; exp?: number } {
        try {
            const payload = token.split('.')[1];
            const decoded = Buffer.from(payload, 'base64url').toString('utf8');
            return JSON.parse(decoded);
        } catch {
            return {};
        }
    }

    private getAuthFilePath(): string {
        return path.join(os.homedir(), '.theia', 'cookbot-auth.json');
    }
}
