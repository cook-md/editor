// *****************************************************************************
// Copyright (C) 2024 STMicroelectronics and others.
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

// The loader hooks registered below only cover the paths Node takes on the
// supported runtime. On Node 20 a CommonJS spec that requires an ESM module
// (e.g. @theia/monaco-editor-core) goes through the synchronous `require(esm)`
// loader, which ignores hooks registered with `register()`. The run then dies
// with `ERR_UNKNOWN_FILE_EXTENSION ... .css`, or - once mocha retries the file
// with `require` after the failed `import` - with the far more confusing
// `The configuration is already set.`. Fail with the real reason instead.
const MINIMUM_NODE_MAJOR = 22;
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < MINIMUM_NODE_MAJOR) {
    throw new Error(
        `Theia tests require Node.js >= ${MINIMUM_NODE_MAJOR}, but this is Node ${process.versions.node}. `
        + 'Switch to a supported version and try again - `.nvmrc` records the expected major. '
        + 'Any installation method works (nvm, fnm, nix, brew); the repo does not standardise on one.'
    );
}

// Register ESM loader hooks so that non-JS imports (e.g. .css files from
// @theia/monaco-editor-core ESM bundles) are handled before mocha attempts
// to load test files. Without this, Node's ESM resolver fails on .css
// imports, and mocha's import→require fallback causes files to be partially
// executed twice, leading to side-effect duplication.
const { register } = require('node:module');
register('./esm-loader-hooks.mjs', require('node:url').pathToFileURL(__filename));

// Mock DragEvent as '@lumino/dragdrop' already requires it at require time
global.DragEvent = class DragEvent { };
