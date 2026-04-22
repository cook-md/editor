// *****************************************************************************
// Copyright (C) 2026 cook.md
//
// SPDX-License-Identifier: MIT
// *****************************************************************************

import * as React from 'react';
import { injectable } from '@theia/core/shared/inversify';
import { AboutDialog } from '@theia/core/lib/browser/about-dialog';

const UPSTREAM_URL = 'https://github.com/eclipse-theia/theia';
const SOURCE_REQUEST_EMAIL = 'alexey@cooklang.org';

@injectable()
export class CookAboutDialog extends AboutDialog {

    protected renderAttribution(): React.ReactNode {
        return <div className='about-details'>
            <h3>Attribution & License</h3>
            <p>
                Cook Editor is a derivative work of{' '}
                <a
                    role='button'
                    tabIndex={0}
                    onClick={() => this.doOpenExternalLink(UPSTREAM_URL)}
                    onKeyDown={(e: React.KeyboardEvent) => this.doOpenExternalLinkEnter(e, UPSTREAM_URL)}>
                    Eclipse Theia
                </a>
                {' '}(v1.70.0 baseline), distributed under the Eclipse Public License v. 2.0
                (EPL-2.0) with secondary licensing under GPL-2.0-only with Classpath-exception-2.0.
            </p>
            <p>
                Cook Editor is not an official Eclipse Foundation product and is not
                endorsed by the Eclipse Foundation. "Eclipse" and "Theia" are trademarks
                of the Eclipse Foundation.
            </p>
            <h3>Source Code Availability</h3>
            <p>
                For a period of three (3) years from the date you received this binary,
                Cooklang will provide, upon written request, a complete machine-readable
                copy of the corresponding source code for the EPL-2.0 / GPL-2.0-covered
                portions of Cook Editor, for no more than the cost of performing this
                distribution.
            </p>
            <p>
                Send requests to <code>{SOURCE_REQUEST_EMAIL}</code> with the subject
                "Cook Editor source code request" and include the version shown above.
            </p>
        </div>;
    }

    protected override render(): React.ReactNode {
        return <div className='theia-aboutDialog'>
            {this.renderHeader()}
            {this.renderAttribution()}
            {this.renderExtensions()}
        </div>;
    }
}
