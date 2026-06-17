import { Generator, getConfig, physicalGetRouteNodes } from '@tanstack/router-generator';
import { resolve } from 'node:path';
const cwd = process.cwd();
const config = await getConfig({
  routesDirectory: resolve(cwd, 'src/routes'),
  generatedRouteTree: resolve(cwd, 'src/routeTree.gen.ts'),
  quoteStyle: 'single',
}, cwd);
const gen = new Generator({ config, root: cwd, fs: undefined, getRouteNodesFn: physicalGetRouteNodes });
await gen.run();
console.log('done');
