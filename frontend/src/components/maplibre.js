// MapLibre v6 resolves its web worker from a runtime-computed URL that Vite cannot see,
// so the worker would be missing from production builds. Let Vite bundle it explicitly.
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);

export * from 'maplibre-gl';
