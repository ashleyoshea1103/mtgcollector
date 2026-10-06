/**
 * Embedded in development-only code (the component gallery and fixture data).
 * scripts/verify.sh fails if this string appears in the production bundle, so
 * dev-only code can't ship whatever route or file it lives in.
 */
export const DEV_ONLY_MARKER = 'mtgcollector:dev-only';
