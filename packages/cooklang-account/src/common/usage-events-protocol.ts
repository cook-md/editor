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

export const UsageEventsServicePath = '/services/cook-usage-events';
export const UsageEventsService = Symbol('UsageEventsService');

export type UsageEventName =
    | 'editor_welcome_shown'
    | 'editor_checklist_clicked'
    | 'editor_checklist_completed'
    | 'cookbot_gate_shown'
    | 'cookbot_gate_clicked'
    | 'editor_cookbot_first_message';

/**
 * Properties are an allow-listed, flat map of small values. Never put recipe
 * content, file or folder names, paths, prompt text or email in here.
 */
export type UsageEventProperties = Record<string, string | number | boolean>;

export interface UsageEvent {
    name: UsageEventName;
    properties: UsageEventProperties;
    /** ISO 8601 */
    time: string;
}

export interface UsageEventContext {
    /** The renderer's navigator.userAgent. Ahoy drops requests without a recognisable OS. */
    userAgent: string;
    appVersion: string;
}

/** RPC-safe (no Event properties; see auth-protocol.ts). */
export interface UsageEventsService {
    track(event: UsageEvent, context: UsageEventContext): Promise<void>;
}
