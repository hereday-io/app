// Last step of `npm run build`: no source map ships in dist/.
// See scripts/lib/sourcemaps.mjs.
import { removeSourceMaps } from './lib/sourcemaps.mjs';

const removed = removeSourceMaps('dist');
if (removed.length > 0) {
  console.log(`[strip-sourcemaps] removed ${removed.length} .map file(s) from dist/`);
}
