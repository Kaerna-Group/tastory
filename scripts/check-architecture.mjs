import ts from 'typescript';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { checkImport, checkExternal } from './architecture-rules.mjs';
const root = process.cwd(),
  normalize = (value) => value.replaceAll('\\', '/');
const files = [
  ...globSync(['apps/*/src/**/*.ts', 'apps/*/src/**/*.tsx', 'packages/*/src/**/*.ts']),
].map(normalize);
const known = new Set(files),
  graph = new Map(),
  errors = [];
const base = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  baseUrl: path.resolve('apps/web'),
  paths: { '@/*': ['src/*'] },
};
for (const file of files) {
  const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    ),
    edges = [];
  function visit(node) {
    if (ts.isExportDeclaration(node) && !node.exportClause)
      errors.push(file + ': export * запрещен.');
    let specifier;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specifier = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
        specifier = node.arguments[0].text;
      else errors.push(file + ': динамический import должен иметь литеральный путь.');
    }
    if (specifier && !specifier.endsWith('.css')) {
      const resolved = ts.resolveModuleName(
        specifier,
        path.resolve(file),
        base,
        ts.sys,
      ).resolvedModule;
      const target = resolved ? normalize(path.relative(root, resolved.resolvedFileName)) : '';
      if (known.has(target)) {
        edges.push(target);
        const problem = checkImport(file, target, specifier);
        if (problem) errors.push(file + ' → ' + specifier + ': ' + problem);
      } else if (
        specifier.startsWith('.') ||
        specifier.startsWith('@/') ||
        specifier.startsWith('@tastory/')
      ) {
        errors.push(file + ': не разрешен локальный импорт ' + specifier);
      } else {
        const problem = checkExternal(file, specifier);
        if (problem) errors.push(file + ' → ' + specifier + ': ' + problem);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  graph.set(file, edges);
}
const visited = new Set(),
  active = new Set();
function walk(file, chain) {
  if (active.has(file)) {
    errors.push('Цикл: ' + [...chain, file].join(' → '));
    return;
  }
  if (visited.has(file)) return;
  active.add(file);
  for (const dependency of graph.get(file) ?? []) walk(dependency, [...chain, file]);
  active.delete(file);
  visited.add(file);
}
for (const file of files) walk(file, []);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Architecture: ' +
      files.length +
      ' files; FSD, public APIs, package boundaries and cycles passed.',
  );
