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

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import {
    ActiveTimer,
    TimerRecipeRef,
    addTime,
    createAndStart,
    finish,
    fireAtMs,
    isExpired,
    matchesRef,
    pause,
    reset,
    restart,
    resume,
} from '../common/cooking-timer';

/**
 * Owns every live cooking timer for the window. A port of the iOS app's
 * `TimerManager` plus `TimerStorage`
 * (`Packages/Timers/Sources/Timers/Core/`).
 *
 * A single interval ticks once a second while at least one timer is running:
 * it both detects expiry and drives countdown re-renders in the preview and
 * the Timers panel. It is torn down as soon as nothing is running.
 */
@injectable()
export class CookingTimerService implements Disposable {

    static readonly STORAGE_KEY = 'cooklang.timers';
    /** Matches the iOS `TimerManager.maxRetainedTimers`. */
    static readonly MAX_TIMERS = 20;

    @inject(StorageService)
    protected readonly storageService: StorageService;

    protected readonly timers = new Map<string, ActiveTimer>();

    protected readonly onDidChangeTimersEmitter = new Emitter<void>();
    readonly onDidChangeTimers: Event<void> = this.onDidChangeTimersEmitter.event;

    protected readonly onDidFinishTimerEmitter = new Emitter<ActiveTimer>();
    readonly onDidFinishTimer: Event<ActiveTimer> = this.onDidFinishTimerEmitter.event;

    protected tickHandle: ReturnType<typeof setInterval> | undefined;

    @postConstruct()
    protected init(): void {
        // Never make this method async: Inversify 6.2.2 treats an async
        // @postConstruct as an async binding and the whole frontend fails to
        // construct. Kick the load off and let it settle on its own.
        this.restore().catch(e => console.warn('Could not restore cooking timers', e));
    }

    // --- Overridable seams (tests substitute a fake clock and ids) ---

    protected now(): number {
        return Date.now();
    }

    protected newId(): string {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    // --- Query ---

    /** Every timer, in insertion order. */
    list(): ActiveTimer[] {
        return Array.from(this.timers.values());
    }

    get(id: string): ActiveTimer | undefined {
        return this.timers.get(id);
    }

    /** The timer started for `ref`'s step and position, whatever its scale. */
    find(ref: TimerRecipeRef): ActiveTimer | undefined {
        for (const timer of this.timers.values()) {
            if (matchesRef(timer, ref)) {
                return timer;
            }
        }
        return undefined;
    }

    nowMs(): number {
        return this.now();
    }

    // --- Commands ---

    /**
     * Start the timer for `ref`. If one is already there — paused, finished, or
     * still running — it is restarted rather than duplicated.
     */
    start(ref: TimerRecipeRef, title: string, durationSeconds: number): ActiveTimer {
        const now = this.now();
        const existing = this.find(ref);
        if (existing) {
            // Re-read title, duration and scale: the recipe may have been
            // edited or re-scaled since this timer was first started.
            const updated = { ...existing, title, durationSeconds, recipeRef: ref };
            return this.replace(restart(updated, now));
        }
        return this.replace(createAndStart(this.newId(), title, durationSeconds, now, ref));
    }

    pause(id: string): void {
        this.mutate(id, timer => pause(timer, this.now()));
    }

    resume(id: string): void {
        this.mutate(id, timer => resume(timer, this.now()));
    }

    /** Pause a running timer, resume a paused one, restart a finished one. */
    toggle(id: string): void {
        const timer = this.timers.get(id);
        if (!timer) {
            return;
        }
        const now = this.now();
        this.mutate(id, () => {
            switch (timer.state) {
                case 'running':
                    return pause(timer, now);
                case 'paused':
                    return resume(timer, now);
                case 'finished':
                    return restart(timer, now);
            }
        });
    }

    reset(id: string): void {
        this.mutate(id, timer => reset(timer, this.now()));
    }

    restart(id: string): void {
        this.mutate(id, timer => restart(timer, this.now()));
    }

    addTime(id: string, seconds: number): void {
        this.mutate(id, timer => addTime(timer, seconds, this.now()));
    }

    remove(id: string): void {
        if (this.timers.delete(id)) {
            this.changed();
        }
    }

    removeFinished(): void {
        let removed = false;
        for (const timer of this.list()) {
            if (timer.state === 'finished') {
                this.timers.delete(timer.id);
                removed = true;
            }
        }
        if (removed) {
            this.changed();
        }
    }

    removeAll(): void {
        if (this.timers.size > 0) {
            this.timers.clear();
            this.changed();
        }
    }

    dispose(): void {
        this.stopTicking();
        this.onDidChangeTimersEmitter.dispose();
        this.onDidFinishTimerEmitter.dispose();
    }

    // --- Internals ---

    protected replace(timer: ActiveTimer): ActiveTimer {
        this.timers.set(timer.id, timer);
        this.evictOldest();
        this.changed();
        return timer;
    }

    protected mutate(id: string, transform: (timer: ActiveTimer) => ActiveTimer): void {
        const timer = this.timers.get(id);
        if (!timer) {
            return;
        }
        this.timers.set(id, transform(timer));
        this.changed();
    }

    protected changed(): void {
        this.persist();
        this.updateTicking();
        this.onDidChangeTimersEmitter.fire();
    }

    /**
     * Drop the least recently touched timers once there are more than
     * {@link MAX_TIMERS}, matching iOS `cleanupOldTimers`.
     */
    protected evictOldest(): void {
        if (this.timers.size <= CookingTimerService.MAX_TIMERS) {
            return;
        }
        const keep = new Set(
            this.list()
                .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
                .slice(0, CookingTimerService.MAX_TIMERS)
                .map(timer => timer.id)
        );
        for (const timer of this.list()) {
            if (!keep.has(timer.id)) {
                this.timers.delete(timer.id);
            }
        }
    }

    protected async persist(): Promise<void> {
        try {
            await this.storageService.setData(CookingTimerService.STORAGE_KEY, this.list());
        } catch (e) {
            console.warn('Could not persist cooking timers', e);
        }
    }

    /**
     * Reload timers saved by an earlier session. A timer whose fire time has
     * already passed comes back finished, but no `onDidFinishTimer` is fired:
     * the alarm belongs to the moment it expired, not to startup.
     */
    protected async restore(): Promise<void> {
        const stored = await this.storageService.getData<ActiveTimer[]>(CookingTimerService.STORAGE_KEY, []);
        const now = this.now();
        for (const timer of stored ?? []) {
            this.timers.set(timer.id, isExpired(timer, now) ? finish(timer, now) : timer);
        }
        this.evictOldest();
        this.updateTicking();
        this.onDidChangeTimersEmitter.fire();
    }

    protected hasRunning(): boolean {
        return this.list().some(timer => timer.state === 'running');
    }

    protected updateTicking(): void {
        if (this.hasRunning()) {
            this.startTicking();
        } else {
            this.stopTicking();
        }
    }

    protected startTicking(): void {
        if (this.tickHandle === undefined) {
            this.tickHandle = setInterval(() => this.tick(), 1000);
        }
    }

    protected stopTicking(): void {
        if (this.tickHandle !== undefined) {
            clearInterval(this.tickHandle);
            this.tickHandle = undefined;
        }
    }

    protected tick(): void {
        const now = this.now();
        const finished: ActiveTimer[] = [];
        for (const timer of this.list()) {
            if (isExpired(timer, now)) {
                const done = finish(timer, now);
                this.timers.set(done.id, done);
                finished.push(done);
            }
        }
        if (finished.length > 0) {
            this.persist();
        }
        this.updateTicking();
        // Fired every second so countdowns re-render, not only on state change.
        this.onDidChangeTimersEmitter.fire();
        for (const timer of finished) {
            this.onDidFinishTimerEmitter.fire(timer);
        }
    }

    /** Running timers first, soonest to fire at the top, then paused, then finished. */
    static sortForDisplay(timers: ActiveTimer[]): ActiveTimer[] {
        const rank: Record<string, number> = { running: 0, paused: 1, finished: 2 };
        return [...timers].sort((a, b) => {
            const byState = rank[a.state] - rank[b.state];
            if (byState !== 0) {
                return byState;
            }
            if (a.state === 'running') {
                return (fireAtMs(a) ?? 0) - (fireAtMs(b) ?? 0);
            }
            return b.updatedAtMs - a.updatedAtMs;
        });
    }
}
