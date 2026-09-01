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
import { ActiveTimer, TimerRecipeRef, remainingSeconds } from '../common/cooking-timer';
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
});
