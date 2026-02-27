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
import { injectable } from '@theia/core/shared/inversify';
import { CookbotAuthService, AuthData, AuthState, LoginResult } from '../common/cookbot-auth-protocol';

const CALLBACK_PORT = 19285;
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

@injectable()
export class CookbotAuthServiceImpl implements CookbotAuthService {

    private authData: AuthData | undefined;
    private callbackServer: http.Server | undefined;
    private callbackTimeout: ReturnType<typeof setTimeout> | undefined;

    async login(): Promise<LoginResult> {
        this.cleanupCallbackServer();

        const state = crypto.randomUUID();
        const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
        const authUrl = `${webBaseUrl}/auth/desktops?callback=http://localhost:${CALLBACK_PORT}/callback&state=${state}&app=theia`;

        this.startCallbackServer(state);

        return { authUrl };
    }

    async logout(): Promise<void> {
        this.cleanupCallbackServer();

        const authFilePath = this.getAuthFilePath();
        try {
            await fs.promises.unlink(authFilePath);
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err;
            }
        }

        this.authData = undefined;
    }

    async getToken(): Promise<string | undefined> {
        if (!this.authData) {
            await this.loadFromDisk();
        }
        if (this.authData) {
            await this.tryRenewToken();
        }
        return this.authData?.token;
    }

    async getAuthState(): Promise<AuthState> {
        if (!this.authData) {
            await this.loadFromDisk();
        }
        if (this.authData) {
            return { status: 'logged-in', email: this.authData.email };
        }
        return { status: 'logged-out' };
    }

    private startCallbackServer(expectedState: string): void {
        this.callbackServer = http.createServer((req, res) => {
            const url = new URL(req.url || '/', `http://localhost:${CALLBACK_PORT}`);

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
                res.end('<html><body><h1>Login successful!</h1><p>You can close this tab and return to the editor.</p></body></html>');
                this.cleanupCallbackServer();
            }).catch(() => {
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end('<html><body><h1>Error</h1><p>Failed to save authentication data. Please try again.</p></body></html>');
                this.cleanupCallbackServer();
            });
        });

        this.callbackServer.listen(CALLBACK_PORT, '127.0.0.1');

        this.callbackTimeout = setTimeout(() => {
            this.cleanupCallbackServer();
        }, CALLBACK_TIMEOUT_MS);
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
        if (!this.authData?.expiresAt) {
            return;
        }
        const expiresAt = new Date(this.authData.expiresAt).getTime();
        const oneDayMs = 24 * 60 * 60 * 1000;
        if (Date.now() < expiresAt - oneDayMs) {
            return; // Not close to expiry
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
        } catch {
            // Renewal failed, continue with existing token
            console.warn('Token renewal failed, continuing with existing token');
        }
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
