module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo wires up the Reanimated/worklets plugin itself when
  // react-native-reanimated is installed, so it must not be added again here —
  // running it twice breaks worklet code generation.
  return { presets: ['babel-preset-expo'] };
};
