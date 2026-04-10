// *****************************************************************************
// Copyright (C) 2024 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core';
import { PreferenceSchema } from '@theia/core/lib/common/preferences/preference-schema';

export const CONSIDER_GITIGNORE_PREF = 'ai-features.workspaceFunctions.considerGitIgnore';
export const USER_EXCLUDE_PATTERN_PREF = 'ai-features.workspaceFunctions.userExcludes';
export const FILE_CONTENT_MAX_SIZE_KB_PREF = 'ai-features.workspaceFunctions.fileContentMaxSizeKB';

export const WorkspacePreferencesSchema: PreferenceSchema = {
    properties: {
        [CONSIDER_GITIGNORE_PREF]: {
            type: 'boolean',
            title: nls.localize('theia/ai/workspace/considerGitignore/title', 'Consider .gitignore'),
            description: nls.localize(
                'theia/ai/workspace/considerGitignore/description',
                'If enabled, excludes files/folders specified in a global .gitignore file (expected location is the workspace root).'
            ),
            default: true
        },
        [USER_EXCLUDE_PATTERN_PREF]: {
            type: 'array',
            title: nls.localize('theia/ai/workspace/excludedPattern/title', 'Excluded File Patterns'),
            description: nls.localize(
                'theia/ai/workspace/excludedPattern/description',
                'List of patterns (glob or regex) for files/folders to exclude.'
            ),
            default: ['node_modules', 'lib'],
            items: {
                type: 'string'
            }
        },
        [FILE_CONTENT_MAX_SIZE_KB_PREF]: {
            type: 'number',
            title: nls.localize('theia/ai/workspace/fileContentMaxSizeKB/title', 'File Content Max Size (KB)'),
            description: nls.localize(
                'theia/ai/workspace/fileContentMaxSizeKB/description',
                'Maximum size in kilobytes of the content returned by the getFileContent tool. ' +
                'When reading a full file (no offset/limit), files exceeding this limit return an error. ' +
                'When using offset and limit, only the requested range is checked against this limit.'
            ),
            default: 256,
            minimum: 1
        }
    }
};
