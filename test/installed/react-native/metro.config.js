// The Metro config of a React Native app (what `npx @react-native-community/cli init` writes).
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

module.exports = mergeConfig(getDefaultConfig(__dirname), {});
