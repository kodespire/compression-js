// The app's Metro config, for a bundle that runs in Node.js: react-native is replaced by a
// stub (no native module is linked, so each codec falls back to WebAssembly), and React
// Native's startup code, which needs the native runtime, is left out. Resolution is
// otherwise unchanged, including the "react-native" export condition.
const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  resolver: {
    resolveRequest(context, moduleName, platform) {
      if (moduleName === 'react-native') {
        return { type: 'sourceFile', filePath: path.join(__dirname, 'react-native-stub.js') };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
  serializer: { getModulesRunBeforeMainModule: () => [] },
});
