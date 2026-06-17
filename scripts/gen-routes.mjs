import { generator, getConfig } from '@tanstack/router-generator';
import { resolve } from 'node:path';
const cwd = process.cwd();
const config = await getConfig({ routesDirectory: resolve(cwd, 'src/routes'), generatedRouteTree: resolve(cwd, 'src/routeTree.gen.ts'), quoteStyle: 'single' }, cwd);
await generator(config, cwd);
console.log('done');
