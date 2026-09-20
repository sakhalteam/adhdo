/// <reference types="vite/client" />

/**
 * The build this bundle came from — `define`d in vite.config.ts from the git
 * SHA plus the build time. Shown in the diagnostics panel, because "is the
 * phone even running my fix?" was a real and unanswerable question through four
 * rounds of the installed-on-iOS viewport bug: an installed PWA that resumes
 * rather than cold-launches never re-navigates, so it can sit on old CSS
 * indefinitely and look exactly like a failed fix.
 */
declare const __BUILD_ID__: string
