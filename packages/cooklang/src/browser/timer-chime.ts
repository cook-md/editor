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

import { injectable } from '@theia/core/shared/inversify';

/** Frequency in Hz and relative level for each partial of one bell strike. */
const PARTIALS: ReadonlyArray<readonly [number, number]> = [
    [880, 1],
    [1320, 0.4],
    [1760, 0.2],
];

const STRIKES = 3;
const STRIKE_SPACING_SECONDS = 0.45;
const STRIKE_LENGTH_SECONDS = 0.4;

/**
 * The sound a finished timer makes. Synthesized rather than shipped as an
 * audio file: the generated webpack config has no rule for audio assets, so a
 * `.wav` import would silently fail to bundle.
 */
@injectable()
export class TimerChime {

    protected context: AudioContext | undefined;
    protected master: AudioNode | undefined;

    play(): void {
        try {
            const context = this.audioContext();
            // A context created before any user gesture starts suspended.
            context.resume().catch(() => { /* a context that will not resume simply stays silent */ });
            const master = this.masterOutput(context);
            for (let i = 0; i < STRIKES; i++) {
                this.strike(context, master, context.currentTime + i * STRIKE_SPACING_SECONDS);
            }
        } catch (e) {
            console.debug('Could not play the timer chime', e);
        }
    }

    protected audioContext(): AudioContext {
        if (!this.context) {
            this.context = new AudioContext();
        }
        return this.context;
    }

    /**
     * A compressor between the strikes and the speakers. Several timers can
     * finish in the same second and each strike schedules three oscillators,
     * so without this the summed gain clips into distortion.
     */
    protected masterOutput(context: AudioContext): AudioNode {
        if (!this.master) {
            const compressor = context.createDynamicsCompressor();
            compressor.connect(context.destination);
            this.master = compressor;
        }
        return this.master;
    }

    /** One bell strike: a struck-metal spectrum under an exponential decay. */
    protected strike(context: AudioContext, master: AudioNode, at: number): void {
        const envelope = context.createGain();
        envelope.gain.setValueAtTime(0.0001, at);
        envelope.gain.exponentialRampToValueAtTime(0.3, at + 0.01);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + STRIKE_LENGTH_SECONDS);
        envelope.connect(master);

        for (const [frequency, level] of PARTIALS) {
            const oscillator = context.createOscillator();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(frequency, at);

            const partialGain = context.createGain();
            partialGain.gain.setValueAtTime(level, at);

            oscillator.connect(partialGain);
            partialGain.connect(envelope);
            oscillator.start(at);
            oscillator.stop(at + STRIKE_SPACING_SECONDS);
        }
    }
}
