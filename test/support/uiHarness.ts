import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import type { ElementType, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export type Attrs = Record<string, string>;

const nodeRequire = createRequire(import.meta.url);
const packageUrl = (specifier: string) => pathToFileURL(nodeRequire.resolve(specifier)).href;

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url));

const EXTERNAL: Record<string, string> = {
  react: packageUrl('react'),
  'react/jsx-runtime': packageUrl('react/jsx-runtime'),
  'react-dom': packageUrl('react-dom'),
  'next/link': packageUrl('next/link'),
  'next/navigation': packageUrl('next/navigation'),
  'lucide-react': packageUrl('lucide-react'),
};

const bundled = new Map<string, Promise<string>>();

function resolveSource(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = /\.(tsx?|mts)$/.test(base)
    ? [base]
    : [`${base}.tsx`, `${base}.ts`, resolve(base, 'index.tsx'), resolve(base, 'index.ts')];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`${fromFile} imports ${specifier}, which does not resolve to a .ts or .tsx file`);
  if (!found.startsWith(APP_DIR)) throw new Error(`${fromFile} imports ${specifier}, which is outside app/`);
  return found;
}

async function transpile(file: string): Promise<string> {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: false,
    },
  });
  const statement = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;
  const resolved = new Map<string, string>();
  for (const [, , specifier] of outputText.matchAll(statement)) {
    if (resolved.has(specifier)) continue;
    if (specifier.endsWith('.module.css')) continue;
    if (specifier.endsWith('.css')) {
      resolved.set(specifier, 'data:text/javascript,');
      continue;
    }
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      resolved.set(specifier, await bundle(resolveSource(file, specifier)));
    } else if (EXTERNAL[specifier]) {
      resolved.set(specifier, EXTERNAL[specifier]);
    } else {
      throw new Error(`${file} imports ${specifier}, which the test harness does not resolve`);
    }
  }
  const code = outputText
    .replace(
      /^import (\w+) from ['"][^'"]+\.module\.css['"];/gm,
      'const $1 = new Proxy({}, { get: (_target, key) => String(key) });',
    )
    .replace(statement, (match, head: string, specifier: string) => {
      const target = resolved.get(specifier);
      return target ? `${head}'${target}'` : match;
    });
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}

function bundle(file: string): Promise<string> {
  let pending = bundled.get(file);
  if (!pending) {
    pending = transpile(file);
    bundled.set(file, pending);
  }
  return pending;
}

export async function loadAppModule<T = Record<string, unknown>>(pathFromApp: string): Promise<T> {
  return (await import(await bundle(resolve(APP_DIR, pathFromApp)))) as T;
}

export async function loadUi<T = Record<string, unknown>>(file: string): Promise<T> {
  return loadAppModule<T>(`_ui/${file}`);
}

export async function loadUiExport(file: string, name: string): Promise<ElementType> {
  const mod = await loadUi<Record<string, ElementType>>(file);
  const value = mod[name];
  if (!value) throw new Error(`_ui/${file} does not export ${name}`);
  return value;
}

export function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

export function tagsOf(html: string, tag: string): Attrs[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))].map((match) => {
    const attrs: Attrs = {};
    for (const [, name, value] of match[1].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[name] = value ?? '';
    return attrs;
  });
}

export function classesOf(attrs: Attrs | undefined): string[] {
  return (attrs?.class ?? '').split(' ').filter(Boolean);
}

export function withClass(html: string, tag: string, className: string): Attrs[] {
  return tagsOf(html, tag).filter((attrs) => classesOf(attrs).includes(className));
}

export function textById(html: string, id: string | undefined): string | undefined {
  if (!id) return undefined;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`id="${escaped}"[^>]*>([^<]*)<`))?.[1];
}

export function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}
