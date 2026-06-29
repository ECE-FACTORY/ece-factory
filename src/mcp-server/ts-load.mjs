// Dependency-free TypeScript ESM loader for the MCP server entrypoint. Node v26's native type-stripping is
// strip-only (it rejects TS parameter properties / enums used across the codebase), so we transpile `.ts`
// on the fly with the `typescript` compiler that is ALREADY a devDependency (no new dependency, no build
// step). Synchronous in-thread hooks (Node 26 `module.registerHooks`). A resolve hook maps `.js`→`.ts`.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
    const tsUrl = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(tsUrl))) return { url: tsUrl.href, shortCircuit: true };
  }
  return next(specifier, context);
}

export function load(url, context, next) {
  if (url.endsWith('.ts')) {
    const src = readFileSync(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: fileURLToPath(url),
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  }
  return next(url, context);
}
