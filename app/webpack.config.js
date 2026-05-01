/**
 * This file can be edited to customize webpack configuration.
 * To reset delete this file and rerun theia build again.
 */
// @ts-check
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const configs = require('./gen-webpack.config.js');
const nodeConfig = require('./gen-webpack.node.config.js');

/**
 * Expose bundled modules on window.theia.moduleName namespace, e.g.
 * window['theia']['@theia/core/lib/common/uri'].
 * Such syntax can be used by external code, for instance, for testing.
 */
configs[0].module.rules.push({
    test: /\.js$/,
    loader: require.resolve('@theia/application-manager/lib/expose-loader')
});

// Exclude NAPI-RS native addon from webpack bundling.
// The NAPI-RS index.js uses __dirname + existsSync to locate .node binaries,
// which breaks when processed by webpack. Let Node.js resolve it at runtime.
nodeConfig.config.externals = Object.assign({}, nodeConfig.config.externals, {
    '@theia/cooklang-native': 'commonjs @theia/cooklang-native'
});

// Copy the cookbot gRPC proto file to where the bundled backend expects it.
// The backend webpack bundle outputs to lib/backend/ and sets __dirname: false,
// so CookbotGrpcClient resolves the proto as ../../proto/cookbot.proto relative
// to lib/backend/, which lands at app/proto/.
nodeConfig.config.plugins.push(
    new CopyPlugin({
        patterns: [{
            from: path.resolve(__dirname, '../packages/cooklang-ai/proto/cookbot.proto'),
            to: path.resolve(__dirname, 'proto/cookbot.proto')
        }]
    })
);

module.exports = [
    ...configs,
    nodeConfig.config
];
