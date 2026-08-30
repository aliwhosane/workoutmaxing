/**
 * Dynamic Expo config.
 *
 * Everything stable lives in app.json. This file layers on the parts that
 * depend on credentials, so no client id or secret is ever committed.
 *
 * Google Sign-In needs `iosUrlScheme` (the reversed iOS OAuth client id) at
 * *build* time — it becomes a URL scheme in Info.plist, so it cannot be
 * supplied at runtime. When it is absent the plugin is simply left out: the app
 * still builds and runs, and Google sign-in reports itself unavailable rather
 * than crashing. Apple sign-in and the whole offline app are unaffected.
 *
 * Set these in `.env` (see .env.example) or in EAS project secrets.
 */
module.exports = ({ config }) => {
  const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;
  const plugins = [...(config.plugins ?? [])];

  if (iosUrlScheme) {
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }]);
  } else if (process.env.EAS_BUILD) {
    // A release build silently missing Google sign-in is a shipping bug.
    throw new Error(
      'GOOGLE_IOS_URL_SCHEME is required for a build. Set it in EAS secrets, ' +
      'or remove Google sign-in from the sign-in screen.',
    );
  }

  return {
    ...config,
    plugins,
    extra: {
      ...config.extra,
      // Read at runtime via expo-constants. Public identifiers, not secrets.
      googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID ?? null,
      googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID ?? null,
      apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:8080',
    },
  };
};
