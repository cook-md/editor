// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { interfaces } from '@theia/core/shared/inversify';
import {
    createPreferenceProxy,
    PreferenceContribution,
    PreferenceProxy,
    PreferenceSchema,
    PreferenceService,
} from '@theia/core/lib/common/preferences';

export const cooklangPreferencesSchema: PreferenceSchema = {
    'properties': {
        'cooklang.openInPreviewMode': {
            'type': 'boolean',
            'description': 'Open .cook files in preview mode by default.',
            'default': true
        }
    }
};

export interface CooklangConfiguration {
    'cooklang.openInPreviewMode': boolean;
}

export const CooklangPreferenceContribution = Symbol('CooklangPreferenceContribution');
export const CooklangPreferences = Symbol('CooklangPreferences');
export type CooklangPreferences = PreferenceProxy<CooklangConfiguration>;

export function createCooklangPreferences(preferences: PreferenceService, schema: PreferenceSchema = cooklangPreferencesSchema): CooklangPreferences {
    return createPreferenceProxy(preferences, schema);
}

export function bindCooklangPreferences(bind: interfaces.Bind): void {
    bind(CooklangPreferences).toDynamicValue(ctx => {
        const preferences = ctx.container.get<PreferenceService>(PreferenceService);
        const contribution = ctx.container.get<PreferenceContribution>(CooklangPreferenceContribution);
        return createCooklangPreferences(preferences, contribution.schema);
    }).inSingletonScope();
    bind(CooklangPreferenceContribution).toConstantValue({ schema: cooklangPreferencesSchema });
    bind(PreferenceContribution).toService(CooklangPreferenceContribution);
}
