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

import { expect } from 'chai';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { ActiveTimer, TimerRecipeRef, remainingSeconds, createAndStart, pause, finish } from '../common/cooking-timer';
import { CookingTimerService } from './cooking-timer-service';

const T0 = 1_700_000_000_000;

class FakeStorage {
    data = new Map<string, unknown>();
    writes = 0;
    async setData<T>(key: string, value: T): Promise<void> {
        this.writes++;
        this.data.set(key, JSON.parse(JSON.stringify(value)));
    }
    async getData<T>(key: string, defaultValue?: T): Promise<T | undefined> {
        return this.data.has(key) ? this.data.get(key) as T : defaultValue;
    }
}

/** Exposes the clock, the id generator and the protected lifecycle to tests. */
class TestTimerService extends CookingTimerService {
    currentTimeMs = T0;
    protected idCounter = 0;
    protected override now(): number {
        return this.currentTimeMs;
    }
    protected override newId(): string {
        return `t${++this.idCounter}`;
    }
    /** Number of live tick intervals; 0 or 1. */
    get ticking(): boolean {
        return this.tickHandle !== undefined;
    }
    async load(): Promise<void> {
        await this.restore();
    }
    tickNow(): void {
        this.tick();
    }
}

function ref(overrides: Partial<TimerRecipeRef> = {}): TimerRecipeRef {
    return {
        recipePath: 'file:///recipes/Soup.cook',
        recipeName: 'Soup',
        globalStepIndex: 2,
        timerPosition: 0,
        scale: 1,
        ...overrides,
    };
}

function createService(storage: FakeStorage): TestTimerService {
    const service = new TestTimerService();
    (service as unknown as { storageService: StorageService }).storageService =
        storage as unknown as StorageService;
    return service;
}

describe('CookingTimerService', () => {

    it('starts a timer, keeps it, and persists it', async () => {
        const storage = new FakeStorage();
        const service = createService(storage);
        await service.load();

        service.start(ref(), 'simmer', 600);

        expect(service.list()).to.have.length(1);
        expect(service.list()[0].title).to.equal('simmer');
        expect(service.find(ref())?.id).to.equal('t1');
        expect(storage.data.get('cooklang.timers')).to.have.length(1);
        expect(service.ticking).to.equal(true);
    });

    it('finds a timer regardless of the scale in the lookup ref', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref({ scale: 1 }), 'simmer', 600);
        expect(service.find(ref({ scale: 4 }))?.id).to.equal('t1');
    });

    it('restarts an existing timer instead of creating a second one for the same step', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref(), 'simmer', 600);
        service.start(ref(), 'simmer', 600);
        expect(service.list()).to.have.length(1);
    });

    it('fires onDidFinishTimer when a running timer expires', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        const finished: ActiveTimer[] = [];
        service.onDidFinishTimer(timer => finished.push(timer));

        service.start(ref(), 'simmer', 600);
        service.currentTimeMs = T0 + 599_000;
        service.tickNow();
        expect(finished).to.have.length(0);

        service.currentTimeMs = T0 + 600_000;
        service.tickNow();
        expect(finished.map(t => t.id)).to.deep.equal(['t1']);
        expect(service.list()[0].state).to.equal('finished');
    });

    it('stops ticking once nothing is running', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref(), 'simmer', 600);
        expect(service.ticking).to.equal(true);
        service.pause('t1');
        expect(service.ticking).to.equal(false);
        service.resume('t1');
        expect(service.ticking).to.equal(true);
    });

    it('restores timers and keeps counting down', async () => {
        const storage = new FakeStorage();
        const first = createService(storage);
        await first.load();
        first.start(ref(), 'simmer', 600);
        first.dispose();

        const second = createService(storage);
        second.currentTimeMs = T0 + 120_000;
        await second.load();

        expect(second.list()).to.have.length(1);
        expect(remainingSeconds(second.list()[0], second.currentTimeMs)).to.equal(480);
    });

    it('restores a timer that expired while the app was closed as finished, without alarming', async () => {
        const storage = new FakeStorage();
        const first = createService(storage);
        await first.load();
        first.start(ref(), 'simmer', 600);
        first.dispose();

        const second = createService(storage);
        second.currentTimeMs = T0 + 3_600_000;
        const finished: ActiveTimer[] = [];
        second.onDidFinishTimer(timer => finished.push(timer));
        await second.load();

        expect(second.list()[0].state).to.equal('finished');
        expect(finished).to.have.length(0);
    });

    it('keeps only the 20 most recently updated timers', async () => {
        const storage = new FakeStorage();
        const service = createService(storage);
        await service.load();
        for (let i = 0; i < 25; i++) {
            service.currentTimeMs = T0 + i * 1000;
            service.start(ref({ globalStepIndex: i }), `timer ${i}`, 600);
        }
        expect(service.list()).to.have.length(20);
        expect(service.find(ref({ globalStepIndex: 0 }))).to.equal(undefined);
        expect(service.find(ref({ globalStepIndex: 24 }))).to.not.equal(undefined);
    });

    it('removes finished timers on request and leaves the rest', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref({ globalStepIndex: 1 }), 'a', 600);
        service.start(ref({ globalStepIndex: 2 }), 'b', 600);
        service.currentTimeMs = T0 + 600_000;
        service.tickNow();
        service.resume('t1');
        service.removeFinished();
        expect(service.list().map(t => t.id)).to.deep.equal(['t1']);
    });

    it('notifies listeners on every change', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        let changes = 0;
        service.onDidChangeTimers(() => changes++);
        service.start(ref(), 'simmer', 600);
        service.pause('t1');
        service.addTime('t1', 60);
        service.remove('t1');
        expect(changes).to.equal(4);
    });

    it('drops unreadable records without losing the good ones', async () => {
        const storage = new FakeStorage();
        const good = {
            id: 'keep', title: 'good', durationSeconds: 600,
            state: 'paused', pausedRemainingSeconds: 600, updatedAtMs: T0,
        };
        storage.data.set('cooklang.timers', [
            undefined,
            'nonsense',
            42,
            { id: 'no-state', title: 'x', durationSeconds: 60, updatedAtMs: T0 },
            { id: 'bad-state', title: 'x', durationSeconds: 60, state: 'idle', updatedAtMs: T0 },
            { title: 'no id', durationSeconds: 60, state: 'paused', updatedAtMs: T0 },
            good,
        ]);
        const service = createService(storage);
        await service.load();
        expect(service.list().map(t => t.id)).to.deep.equal(['keep']);
    });

    it('ignores stored data that is not a list', async () => {
        const storage = new FakeStorage();
        storage.data.set('cooklang.timers', { nope: true });
        const service = createService(storage);
        await service.load();
        expect(service.list()).to.have.length(0);
    });

    it('refuses a timer that could never expire, so the tick cannot be held open', async () => {
        const storage = new FakeStorage();
        storage.data.set('cooklang.timers', [
            { id: 'nan', title: 'x', durationSeconds: NaN, state: 'running', startedAtMs: T0, updatedAtMs: T0 },
            { id: 'anchorless', title: 'x', durationSeconds: 600, state: 'running', updatedAtMs: T0 },
        ]);
        const service = createService(storage);
        await service.load();
        expect(service.list()).to.have.length(0);
        expect(service.ticking).to.equal(false);
    });

    it('survives a listener that removes a timer while events are firing', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref(), 'simmer', 600);
        service.onDidFinishTimer(timer => service.remove(timer.id));
        service.currentTimeMs = T0 + 600_000;
        service.tickNow();
        expect(service.list()).to.have.length(0);
        expect(service.ticking).to.equal(false);
    });

    it('resets a timer to its full duration, paused', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref(), 'simmer', 600);
        service.currentTimeMs = T0 + 90_000;
        service.reset('t1');
        expect(service.get('t1')?.state).to.equal('paused');
        expect(remainingSeconds(service.get('t1')!, service.currentTimeMs)).to.equal(600);
        expect(service.ticking).to.equal(false);
    });

    it('restarts a finished timer and starts ticking again', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref(), 'simmer', 600);
        service.currentTimeMs = T0 + 600_000;
        service.tickNow();
        expect(service.get('t1')?.state).to.equal('finished');
        service.toggle('t1');
        expect(service.get('t1')?.state).to.equal('running');
        expect(remainingSeconds(service.get('t1')!, service.currentTimeMs)).to.equal(600);
        expect(service.ticking).to.equal(true);
    });

    it('removes everything on removeAll', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref({ globalStepIndex: 1 }), 'a', 600);
        service.start(ref({ globalStepIndex: 2 }), 'b', 600);
        service.removeAll();
        expect(service.list()).to.have.length(0);
        expect(service.ticking).to.equal(false);
    });

    it('stops ticking and forgets everything on dispose', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref(), 'simmer', 600);
        service.dispose();
        expect(service.ticking).to.equal(false);
        expect(service.list()).to.have.length(0);
    });

    it('sorts running first by soonest fire, then paused, then finished', () => {
        const soon = createAndStart('soon', 'soon', 60, T0, ref());
        const later = createAndStart('later', 'later', 600, T0, ref());
        const held = pause(createAndStart('held', 'held', 600, T0, ref()), T0);
        const done = finish(createAndStart('done', 'done', 600, T0, ref()), T0);
        expect(CookingTimerService.sortForDisplay([done, held, later, soon]).map(t => t.id))
            .to.deep.equal(['soon', 'later', 'held', 'done']);
    });
});
