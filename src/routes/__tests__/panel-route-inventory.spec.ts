// @vitest-environment node
/**
 * Wylicza rzeczywiste ekrany routingu i porównuje evidence z call-site'ami.
 *
 * CO MIERZY
 * - AC1: importuje REALNY `RouteMap` (razem z `RouteExtensions` i
 *   `SettingsExtensions`, które `route-map.tsx` rozlewa do drzewa) i wylicza
 *   zbiór ekranów: każdy węzeł z renderem (`lazy`/`Component`/`element`) i
 *   ścieżką. Zbiór porównuje ZBIORAMI NAZW z artefaktem
 *   `_bmad-output/releases/v1.16.0/implementation-artifacts/evidence/5-1/panel-screen-set.yaml`.
 *   Ręczny wpis ekranu bez liścia w routingu ląduje w `missing_in_routing`,
 *   nowy liść bez wpisu w `missing_in_artifact` — obie strony nazwane.
 * - AC2: każdy konsument z `panel-route-inventory.yaml` wskazuje istniejący
 *   plik i linię z zapisanym anchorem, a każda linia w `src/**` z literałem
 *   `/vendor/...` jest przez jakiegoś konsumenta objęta (usunięty konsument
 *   czerwieni test z nazwą pliku i linii).
 * - AC4: nośniki konfiguracji LAN wymienione w artefakcie występują w
 *   nazwanych plikach źródłowych; artefakty nie zawierają wartości
 *   wyglądających na poświadczenia.
 *
 * TRYB ZAPISU: `GP_PANEL_INVENTORY_WRITE=1 pnpm exec vitest --run <ten plik>`
 * regeneruje `panel-screen-set.yaml` z bieżącego routingu. Inwentarz tras
 * regeneruje `python3 _grow/tools/validate_vendor_panel_route_inventory.py --write`.
 *
 * DLACZEGO WŁASNY PARSER YAML: panel nie ma zależności `yaml`/`js-yaml`, a
 * dokładanie jej dla jednego testu poszerzałoby powierzchnię pakietu. Parser
 * obsługuje wyłącznie podzbiór blokowy, który emitują PyYAML `safe_dump`
 * (default_flow_style=False) i serializer poniżej. Nieznana składnia rzuca.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { createRouteMap } from '../../extensions/routes/utils';
import { RouteExtensions } from '../../providers/router-provider/route-extensions';
import { RouteMap } from '../../providers/router-provider/route-map';
import { SettingsExtensions } from '../../providers/router-provider/settings-extensions';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL_ROOT = path.resolve(HERE, '../../..');
const SUPER_ROOT = path.resolve(PANEL_ROOT, '../..');
const RELEASE = 'v1.16.0';
const EVIDENCE_DIR =
  process.env.GP_PANEL_INVENTORY_EVIDENCE_DIR ??
  path.join(
    SUPER_ROOT,
    '_bmad-output',
    'releases',
    RELEASE,
    'implementation-artifacts',
    'evidence',
    '5-1'
  );
const SCREEN_SET_PATH = path.join(EVIDENCE_DIR, 'panel-screen-set.yaml');
const INVENTORY_PATH = path.join(EVIDENCE_DIR, 'panel-route-inventory.yaml');
const ROUTING_SNAPSHOT_PATH = path.join(
  PANEL_ROOT,
  'src/routes/__generated__/panel-route-map.json'
);
const WRITE_MODE = process.env.GP_PANEL_INVENTORY_WRITE === '1';
const SCHEMA_VERSION = 'gp-panel-screen-set.v1';
const ROUTER_PROVIDER_PATH = path.join(
  PANEL_ROOT,
  'src/providers/router-provider/router-provider.tsx'
);
const ROUTER_BASENAME_EXPRESSION = '__BASE__ || "/"';
const ROUTING_SNAPSHOT_INPUTS = [
  'src/routes/__tests__/panel-route-inventory.spec.ts',
  'src/providers/router-provider/route-map.tsx',
  'src/providers/router-provider/route-extensions.tsx',
  'src/providers/router-provider/settings-extensions.tsx',
  'src/extensions/routes/utils.ts'
] as const;

function routingSnapshotSourceFingerprint(): string {
  const hash = createHash('sha256');
  for (const relative of ROUTING_SNAPSHOT_INPUTS) {
    hash.update(relative);
    hash.update('\0');
    hash.update(readFileSync(path.join(PANEL_ROOT, relative)));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

// ---------------------------------------------------------------------------
// Walker po realnym drzewie routera
// ---------------------------------------------------------------------------

export type Screen = {
  screen_id: string;
  route_pattern: string;
  component_module: string;
  component_export: string;
  access: 'protected' | 'public' | 'unclassified';
  layout: string;
  source: 'route-map' | 'route-extensions' | 'settings-extensions';
};

type AnyRoute = RouteObject & { lazy?: unknown; Component?: unknown; element?: unknown };

function nodeName(node: AnyRoute): string | null {
  const el = node.element as { type?: { name?: string; displayName?: string } } | undefined;
  if (el && typeof el === 'object' && el.type) {
    return el.type.displayName ?? el.type.name ?? null;
  }
  const comp = node.Component as { name?: string; displayName?: string } | undefined;
  if (comp && (typeof comp === 'function' || typeof comp === 'object')) {
    return comp.displayName ?? comp.name ?? null;
  }
  return null;
}

function hasRenderer(node: AnyRoute): boolean {
  return typeof node.lazy === 'function' || Boolean(node.Component) || Boolean(node.element);
}

const MODULE_RE = /["']([^"']*\/routes\/[^"']*)["']/;
const EXPORT_RE = /Component:\s*([A-Za-z0-9_$]+)/;

function componentOf(node: AnyRoute): { module: string; exportName: string } {
  if (typeof node.lazy === 'function') {
    const text = String(node.lazy);
    const m = MODULE_RE.exec(text);
    const routeStart = m?.[1].lastIndexOf('routes/') ?? -1;
    const mod = routeStart >= 0 ? `src/${m![1].slice(routeStart)}` : `lazy:${text.slice(0, 80)}`;
    const ex = EXPORT_RE.exec(text);
    return { module: mod, exportName: ex ? ex[1] : 'default' };
  }
  const name = nodeName(node) ?? 'anonymous';
  return { module: `component:${name}`, exportName: name };
}

function joinPattern(parent: string, seg: string | undefined): string {
  if (seg === undefined) return parent;
  if (seg.startsWith('/')) return seg.replace(/\/+$/, '') || '/';
  if (seg === '') return parent;
  const base = parent === '/' ? '' : parent;
  return `${base}/${seg}`;
}

function screenIdOf(pattern: string, isIndex: boolean): string {
  const body =
    pattern === '/'
      ? 'home'
      : pattern
          .replace(/^\//, '')
          .replace(/\//g, '.')
          .replace(/:([A-Za-z0-9_]+)/g, '[$1]')
          .replace(/\*/g, 'splat');
  return isIndex ? `${body}.index` : body;
}

function collectIdentities(routes: RouteObject[], into: Set<RouteObject>): void {
  for (const r of routes) {
    into.add(r);
    if (r.children) collectIdentities(r.children, into);
  }
}

export function deriveScreens(
  root: RouteObject[],
  extensions: { routeExtensions: RouteObject[]; settingsExtensions: RouteObject[] }
): Screen[] {
  const extIds = new Set<RouteObject>();
  collectIdentities(extensions.routeExtensions, extIds);
  const settingsIds = new Set<RouteObject>();
  collectIdentities(extensions.settingsExtensions, settingsIds);
  const out: Screen[] = [];

  const walk = (
    nodes: RouteObject[],
    parentPattern: string,
    access: Screen['access'],
    layout: string,
    source: Screen['source']
  ): void => {
    for (const node of nodes as AnyRoute[]) {
      const name = nodeName(node);
      let nextAccess = access;
      if (name === 'ProtectedRoute') nextAccess = 'protected';
      if (name === 'PublicLayout') nextAccess = 'public';
      let nextLayout = layout;
      if (name === 'MainLayout' || name === 'SettingsLayout' || name === 'PublicLayout')
        nextLayout = name;
      let nextSource = source;
      if (extIds.has(node)) nextSource = 'route-extensions';
      if (settingsIds.has(node)) nextSource = 'settings-extensions';

      const isIndex = node.index === true || node.path === '';
      const pattern = joinPattern(parentPattern, node.path);
      const isLayoutNode =
        name === 'ProtectedRoute' ||
        name === 'MainLayout' ||
        name === 'SettingsLayout' ||
        name === 'PublicLayout' ||
        name === 'Outlet';
      // Renderowalny rodzic z dziećmi jest gałęzią nawigacji, nie dodatkowym
      // ekranem. Jawny index dziecka reprezentuje jego ekran bazowy, więc
      // /products/:id nie może pojawić się obok products.[id].index.
      const isRenderableLeaf = !node.children || node.children.length === 0;
      if (node.path !== undefined && hasRenderer(node) && !isLayoutNode && isRenderableLeaf) {
        const { module, exportName } = componentOf(node);
        out.push({
          screen_id: screenIdOf(pattern, isIndex),
          route_pattern: pattern,
          component_module: module,
          component_export: exportName,
          access: nextAccess,
          layout: nextLayout,
          source: nextSource
        });
      }
      if (node.children) walk(node.children, pattern, nextAccess, nextLayout, nextSource);
    }
  };
  walk(root, '/', 'unclassified', 'none', 'route-map');
  out.sort((a, b) => (a.screen_id < b.screen_id ? -1 : a.screen_id > b.screen_id ? 1 : 0));
  return out;
}

// ---------------------------------------------------------------------------
// Podzbiór YAML: parser + serializer (blokowy, bez kotwic, bez flow poza [] i {})
// ---------------------------------------------------------------------------

type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

function parseScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === '[]') return [];
  if (s === '{}') return {};
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (s.startsWith("'")) {
    if (!s.endsWith("'")) throw new Error(`YAML: niedomknięty napis w apostrofach: ${s}`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('"')) {
    if (!s.endsWith('"')) throw new Error(`YAML: niedomknięty napis w cudzysłowach: ${s}`);
    return JSON.parse(s) as string;
  }
  if (
    s.startsWith('[') ||
    s.startsWith('{') ||
    s.startsWith('&') ||
    s.startsWith('*') ||
    s.startsWith('|') ||
    s.startsWith('>')
  ) {
    throw new Error(`YAML: nieobsługiwana składnia w podzbiorze: ${s}`);
  }
  return s;
}

type Line = { indent: number; text: string; no: number };

export function parseYamlSubset(source: string): YamlValue {
  const lines: Line[] = source
    .split(/\r?\n/)
    .map((t, i) => ({ indent: t.length - t.trimStart().length, text: t.trim(), no: i + 1 }))
    .filter(l => l.text !== '' && !l.text.startsWith('#'));
  let pos = 0;

  const splitKey = (text: string): [string, string] | null => {
    // key: value — klucz bez cudzysłowu; wartość może być pusta
    const m = /^([A-Za-z0-9_\-./]+):(?:\s+(.*))?$/.exec(text);
    if (!m) return null;
    return [m[1], m[2] ?? ''];
  };

  const parseBlock = (indent: number): YamlValue => {
    if (pos >= lines.length) return null;
    const first = lines[pos];
    if (first.text.startsWith('- ')) return parseSeq(first.indent);
    return parseMap(indent);
  };

  const parseMap = (indent: number): { [k: string]: YamlValue } => {
    const out: { [k: string]: YamlValue } = {};
    while (pos < lines.length) {
      const l = lines[pos];
      if (l.indent < indent) break;
      if (l.indent > indent) throw new Error(`YAML:${l.no}: niespodziewane wcięcie w mapie`);
      if (l.text.startsWith('- ')) break;
      const kv = splitKey(l.text);
      if (!kv) throw new Error(`YAML:${l.no}: oczekiwano 'klucz: wartość', jest: ${l.text}`);
      const [key, rest] = kv;
      pos += 1;
      if (rest !== '') {
        out[key] = parseScalar(rest);
        continue;
      }
      const next = lines[pos];
      if (
        !next ||
        next.indent < indent ||
        (next.indent === indent && !next.text.startsWith('- '))
      ) {
        out[key] = null;
        continue;
      }
      if (next.text.startsWith('- ')) {
        out[key] = parseSeq(next.indent);
      } else {
        out[key] = parseMap(next.indent);
      }
    }
    return out;
  };

  const parseSeq = (indent: number): YamlValue[] => {
    const out: YamlValue[] = [];
    while (pos < lines.length) {
      const l = lines[pos];
      if (l.indent !== indent || !l.text.startsWith('- ')) break;
      const body = l.text.slice(2);
      const kv = splitKey(body);
      if (kv && !/^['"]/.test(body)) {
        // element listy będący mapą: pierwsza para na linii z myślnikiem
        const [key, rest] = kv;
        const item: { [k: string]: YamlValue } = {};
        pos += 1;
        if (rest !== '') {
          item[key] = parseScalar(rest);
        } else {
          const next = lines[pos];
          if (next && next.indent > indent) {
            item[key] = next.text.startsWith('- ') ? parseSeq(next.indent) : parseMap(next.indent);
          } else {
            item[key] = null;
          }
        }
        const contIndent = indent + 2;
        const cont = lines[pos];
        if (cont && cont.indent === contIndent && !cont.text.startsWith('- ')) {
          Object.assign(item, parseMap(contIndent));
        }
        out.push(item);
      } else {
        pos += 1;
        out.push(parseScalar(body));
      }
    }
    return out;
  };

  const value = parseBlock(lines[0]?.indent ?? 0);
  if (pos !== lines.length)
    throw new Error(`YAML:${lines[pos].no}: nieprzetworzony ogon dokumentu`);
  return value;
}

function quote(s: string): string {
  const needs =
    s === '' ||
    /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /[:#]\s|\s$/.test(s) ||
    /^(true|false|null|~|-?\d+)$/.test(s) ||
    s.includes('\n');
  return needs ? `'${s.replace(/'/g, "''")}'` : s;
}

export function dumpYamlSubset(value: YamlValue, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const entries = Object.entries(item);
          const lines = entries.map(([k, v], i) => {
            const prefix = i === 0 ? `${pad}- ` : `${pad}  `;
            return `${prefix}${k}:${inlineOrBlock(v, indent + 2)}`;
          });
          return lines.join('\n');
        }
        return `${pad}- ${scalar(item)}`;
      })
      .join('\n');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return entries.map(([k, v]) => `${pad}${k}:${inlineOrBlock(v, indent)}`).join('\n');
  }
  return scalar(value);
}

function inlineOrBlock(v: YamlValue, indent: number): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return ' []';
    return `\n${dumpYamlSubset(v, indent)}`;
  }
  if (v && typeof v === 'object') {
    if (Object.keys(v).length === 0) return ' {}';
    return `\n${dumpYamlSubset(v, indent + 2)}`;
  }
  return ` ${scalar(v)}`;
}

function scalar(v: YamlValue): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return quote(v);
  throw new Error('YAML: wartość złożona w pozycji skalara');
}

// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------

function gitHead(dir: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === '__mocks__' || entry === 'node_modules') continue;
      listSourceFiles(full, out);
    } else if (
      /\.(ts|tsx)$/.test(entry) &&
      !/\.(spec|test)\.(ts|tsx)$/.test(entry) &&
      !entry.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

function readArtifact(p: string): { [k: string]: YamlValue } {
  if (!existsSync(p)) {
    throw new Error(
      `Artefakt nie istnieje: ${p}. Brak pomiaru nie jest PASS-em; zregeneruj (write mode / --write).`
    );
  }
  const parsed = parseYamlSubset(readFileSync(p, 'utf8'));
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length === 0
  ) {
    throw new Error(`Artefakt pusty albo nie jest mapą: ${p}`);
  }
  return parsed as { [k: string]: YamlValue };
}

const SECRET_PATTERNS = [
  /\bpk_[A-Za-z0-9]{12,}/,
  /\bsk_[A-Za-z0-9]{12,}/,
  /\beyJ[A-Za-z0-9_-]{20,}/,
  /\bBearer\s+[A-Za-z0-9_\-.]{16,}/,
  /https?:\/\/[^\s/]+:[^\s/@]+@/,
  /medusa_auth_token=[A-Za-z0-9]/
];

const TRANSPORT_TOKENS: Record<string, RegExp> = {
  fetchQuery: /\bfetchQuery\s*(<[^(]*>)?\s*\(/,
  voucherFetch: /\bvoucherFetch\s*(<[^(]*>)?\s*\(/,
  vendorFetch: /\bvendorFetch\b/,
  sdk: /\bsdk\.(admin|store)\./,
  mercurVendorClient: /\bmercurVendorClient\./,
  'fetch-absolute-backend': /(^|[^A-Za-z0-9_.$])fetch\s*\(/,
  'fetch-relative': /(^|[^A-Za-z0-9_.$])fetch\s*\(/
};

// ---------------------------------------------------------------------------
// AC1 — zbiór ekranów
// ---------------------------------------------------------------------------

const screens = deriveScreens(RouteMap, {
  routeExtensions: RouteExtensions,
  settingsExtensions: SettingsExtensions
});

function routingSnapshot() {
  return {
    schema_version: 'gp-panel-route-map.v1',
    generated_by: 'panel-route-inventory.spec.ts:deriveScreens(RouteMap)',
    source_fingerprint: routingSnapshotSourceFingerprint(),
    screens: screens.map(s => ({ ...s }))
  };
}

describe('AC1: wyliczony zbiór ekranów panelu z realnego RouteMap', () => {
  it('RouteMap zawiera przez tożsamość każdy węzeł RouteExtensions i SettingsExtensions', () => {
    const all = new Set<RouteObject>();
    collectIdentities(RouteMap, all);
    const missing = [...RouteExtensions, ...SettingsExtensions]
      .filter(r => !all.has(r))
      .map(r => r.path ?? '(bez path)');
    expect(missing, 'rozszerzenia nierozlane do RouteMap').toEqual([]);
    expect(Array.isArray(RouteExtensions)).toBe(true);
    expect(Array.isArray(SettingsExtensions)).toBe(true);
  });

  it('walker liczy ekran z rozszerzenia (kontrola pozytywna na syntetycznym drzewie przez createRouteMap)', () => {
    const Demo = () => null;
    const ext = createRouteMap(
      [{ path: '/gp-ext/demo', Component: Demo, handle: undefined as never }] as never,
      ''
    );
    const synthetic: RouteObject[] = [
      {
        Component: function ProtectedRoute() {
          return null;
        },
        children: ext
      }
    ];
    const derived = deriveScreens(synthetic, { routeExtensions: ext, settingsExtensions: [] });
    const ids = derived.map(s => s.screen_id);
    // createRouteMap tworzy gałąź `gp-ext/demo` i liść `path: ""` — stąd sufiks `.index`
    expect(ids).toContain('gp-ext.demo.index');
    const demo = derived.find(s => s.screen_id === 'gp-ext.demo.index')!;
    expect(demo.source).toBe('route-extensions');
    expect(demo.access).toBe('protected');
    // kontrola ujemna: węzeł bez renderu nie jest ekranem
    const branchOnly = deriveScreens([{ path: '/only-branch', children: [] }], {
      routeExtensions: [],
      settingsExtensions: []
    });
    expect(branchOnly).toEqual([]);
  });

  it('walker nie liczy renderowalnego rodzica z dzieckiem jako dwóch ekranów', () => {
    const Parent = () => null;
    const Index = () => null;
    const derived = deriveScreens(
      [{ path: '/parent', Component: Parent, children: [{ path: '', Component: Index }] }],
      { routeExtensions: [], settingsExtensions: [] }
    );
    expect(derived.map(screen => screen.screen_id)).toEqual(['parent.index']);
  });

  it('zbiór ekranów jest niepusty, deterministyczny i w całości sklasyfikowany', () => {
    expect(screens.length).toBeGreaterThan(0);
    const again = deriveScreens(RouteMap, {
      routeExtensions: RouteExtensions,
      settingsExtensions: SettingsExtensions
    });
    expect(again).toEqual(screens);
    const unclassified = screens.filter(s => s.access === 'unclassified').map(s => s.screen_id);
    expect(unclassified, 'ekrany bez ProtectedRoute/PublicLayout nad sobą').toEqual([]);
    const ids = screens.map(s => s.screen_id);
    expect(new Set(ids).size, 'zduplikowane screen_id').toBe(ids.length);
    const unresolvedModules = screens
      .filter(s => s.component_module.startsWith('lazy:'))
      .map(s => s.screen_id);
    expect(unresolvedModules, 'lazy bez rozpoznanego modułu /src/routes/...').toEqual([]);
    expect(ids).toContain('home');
    expect(ids).toContain('login');
    expect(ids).toContain('vouchers.redeem');
    expect(
      ids.some(id => id.startsWith('settings.')),
      'brak ekranów pod /settings'
    ).toBe(true);
    expect(screens.find(s => s.screen_id === 'login')!.access).toBe('public');
    expect(screens.find(s => s.screen_id === 'vouchers.redeem')!.access).toBe('protected');
  });

  it('artefakt panel-screen-set.yaml jest równy zbiorowi wyliczonemu (parity obu stron nazwana)', () => {
    if (WRITE_MODE) {
      const doc: { [k: string]: YamlValue } = {
        schema_version: SCHEMA_VERSION,
        release: RELEASE,
        story: '5.1',
        source_commit: gitHead(SUPER_ROOT),
        panel_commit: gitHead(PANEL_ROOT),
        measured_at: new Date().toISOString().slice(0, 10),
        generator:
          'GP/vendor-panel/src/routes/__tests__/panel-route-inventory.spec.ts (GP_PANEL_INVENTORY_WRITE=1)',
        route_source: {
          'route-map': 'src/providers/router-provider/route-map.tsx',
          'route-extensions': 'src/providers/router-provider/route-extensions.tsx',
          'settings-extensions': 'src/providers/router-provider/settings-extensions.tsx'
        },
        extension_counts: {
          'route-extensions': RouteExtensions.length,
          'settings-extensions': SettingsExtensions.length
        },
        basename: {
          source: 'src/providers/router-provider/router-provider.tsx',
          expression: ROUTER_BASENAME_EXPRESSION,
          effective_default: '/'
        },
        screens: screens.map(s => ({ ...s })),
        derived_names: screens.map(s => s.screen_id),
        count: screens.length,
        parity: { missing_in_artifact: [], missing_in_routing: [] }
      };
      writeFileSync(SCREEN_SET_PATH, `${dumpYamlSubset(doc)}\n`, 'utf8');
      mkdirSync(path.dirname(ROUTING_SNAPSHOT_PATH), { recursive: true });
      writeFileSync(ROUTING_SNAPSHOT_PATH, `${JSON.stringify(routingSnapshot(), null, 2)}\n`, 'utf8');
    }
    expect(existsSync(ROUTING_SNAPSHOT_PATH), 'brak snapshotu wygenerowanego z RouteMap').toBe(true);
    expect(JSON.parse(readFileSync(ROUTING_SNAPSHOT_PATH, 'utf8'))).toEqual(routingSnapshot());
    const doc = readArtifact(SCREEN_SET_PATH);
    expect(doc.schema_version).toBe(SCHEMA_VERSION);
    expect(doc.basename).toEqual({
      source: 'src/providers/router-provider/router-provider.tsx',
      expression: ROUTER_BASENAME_EXPRESSION,
      effective_default: '/'
    });
    expect(readFileSync(ROUTER_PROVIDER_PATH, 'utf8')).toContain(
      'basename: __BASE__ || "/"'
    );
    const artScreens = (doc.screens as YamlValue[] | null) ?? [];
    expect(
      Array.isArray(artScreens) && artScreens.length > 0,
      'pusty zbiór ekranów w artefakcie'
    ).toBe(true);
    const artById = new Map<string, { [k: string]: YamlValue }>();
    for (const s of artScreens as { [k: string]: YamlValue }[]) artById.set(String(s.screen_id), s);
    const derivedIds = new Set(screens.map(s => s.screen_id));
    const missingInArtifact = [...derivedIds].filter(id => !artById.has(id)).sort();
    const missingInRouting = [...artById.keys()].filter(id => !derivedIds.has(id)).sort();
    expect({
      missing_in_artifact: missingInArtifact,
      missing_in_routing: missingInRouting
    }).toEqual({ missing_in_artifact: [], missing_in_routing: [] });
    // pełne rekordy: wzorzec, moduł, dostęp, źródło
    const drift: string[] = [];
    for (const s of screens) {
      const a = artById.get(s.screen_id)!;
      for (const key of [
        'route_pattern',
        'component_module',
        'component_export',
        'access',
        'layout',
        'source'
      ] as const) {
        if (a[key] !== s[key])
          drift.push(`${s.screen_id}.${key}: routing=${String(s[key])} artefakt=${String(a[key])}`);
      }
    }
    expect(drift).toEqual([]);
    expect(doc.derived_names).toEqual(screens.map(s => s.screen_id));
    expect(doc.count).toBe(screens.length);
    const parity = doc.parity as { [k: string]: YamlValue };
    expect(parity.missing_in_artifact).toEqual([]);
    expect(parity.missing_in_routing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC2 — konsumenci tras vs kod
// ---------------------------------------------------------------------------

describe('AC2: inwentarz tras — każdy konsument istnieje, każdy call-site jest objęty', () => {
  const inventory = readArtifact(INVENTORY_PATH);
  const routes = (inventory.routes as { [k: string]: YamlValue }[] | null) ?? [];

  it('inwentarz jest niepusty i każda trasa ma metodę, ścieżkę kanoniczną, transport i konsumentów', () => {
    expect(routes.length).toBeGreaterThan(0);
    const bad = routes
      .filter(
        r =>
          !/^(GET|POST|PUT|PATCH|DELETE)$/.test(String(r.method)) ||
          !String(r.canonical_path).startsWith('/') ||
          !Array.isArray(r.consumers) ||
          (r.consumers as YamlValue[]).length === 0 ||
          !Array.isArray(r.transport)
      )
      .map(r => `${String(r.method)} ${String(r.canonical_path)}`);
    expect(bad).toEqual([]);
    const nonVendor = routes
      .filter(r => !String(r.canonical_path).startsWith('/vendor/'))
      .map(r => `${String(r.method)} ${String(r.canonical_path)}`);
    expect(nonVendor).toContain('GET /store/currencies');
    expect(nonVendor).toContain('GET /admin/refund-reasons');
  });

  it('każdy konsument wskazuje istniejący plik, linię z anchorem i transport widoczny w kodzie', () => {
    const problems: string[] = [];
    for (const r of routes) {
      for (const c of r.consumers as { [k: string]: YamlValue }[]) {
        const file = String(c.file);
        const line = Number(c.line);
        const anchor = String(c.anchor);
        const transport = String(c.transport);
        const rel = file.replace(/^GP\/vendor-panel\//, '');
        const abs = path.join(PANEL_ROOT, rel);
        if (!existsSync(abs)) {
          problems.push(`${file}:${line}: plik nie istnieje`);
          continue;
        }
        const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
        const window = lines.slice(line - 1, line + 6).join('\n');
        const squash = (s: string) => s.replace(/\s+/g, '');
        if (!squash(window).includes(squash(anchor))) {
          problems.push(
            `${file}:${line}: anchor ${JSON.stringify(anchor)} nie występuje od tej linii`
          );
          continue;
        }
        const before = lines.slice(Math.max(0, line - 12), line + 3).join('\n');
        const token = TRANSPORT_TOKENS[transport];
        if (!token) {
          problems.push(`${file}:${line}: nieznany transport ${transport}`);
        } else if (!token.test(before)) {
          problems.push(
            `${file}:${line}: transport ${transport} niewidoczny w oknie wokół anchora`
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('każda linia z literałem HTTP panelu w src/** jest objęta konsumentem (usunięty konsument = czerwono z nazwą)', () => {
    const covered = new Set<string>();
    for (const r of routes) {
      for (const c of r.consumers as { [k: string]: YamlValue }[])
        covered.add(`${String(c.file).replace(/^GP\/vendor-panel\//, '')}:${Number(c.line)}`);
    }
    const literalRe = /(["'`]|\}|\$\{[^}]*\})\/(vendor|store)\/[A-Za-z0-9]/;
    const uncovered: string[] = [];
    for (const file of listSourceFiles(path.join(PANEL_ROOT, 'src'))) {
      const rel = path.relative(PANEL_ROOT, file).split(path.sep).join('/');
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      let inBlockComment = false;
      lines.forEach((text, i) => {
        const t = text.trim();
        if (inBlockComment) {
          if (t.includes('*/')) inBlockComment = false;
          return;
        }
        if (t.startsWith('/*')) {
          if (!t.includes('*/')) inBlockComment = true;
          return;
        }
        if (t.startsWith('//') || t.startsWith('*')) return;
        if (!literalRe.test(text)) return;
        const key = `${rel}:${i + 1}`;
        if (!covered.has(key)) uncovered.push(`${key}: ${t.slice(0, 100)}`);
      });
    }
    expect(uncovered).toEqual([]);
  });

  it('siedem tras z DW-15-172 ma dyspozycję, a /vendor/me nie jest już wołane', () => {
    const hist = (inventory.historical_findings as { [k: string]: YamlValue }[] | null) ?? [];
    const paths = hist.map(h => String(h.path)).sort();
    expect(paths).toEqual([
      '/vendor/customer-groups',
      '/vendor/me',
      '/vendor/members',
      '/vendor/notifications',
      '/vendor/product-collections',
      '/vendor/sellers/me/onboarding',
      '/vendor/sellers/me/reviews'
    ]);
    for (const h of hist) expect(String(h.current_disposition), String(h.path)).not.toBe('');
    const me = hist.find(h => h.path === '/vendor/me')!;
    expect(String(me.current_disposition).startsWith('active')).toBe(false);
    const activeMe = routes
      .filter(r => String(r.canonical_path) === '/vendor/me')
      .map(r => String(r.method));
    expect(activeMe).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC4 — konfiguracja LAN (nazwy nośników, bez wartości)
// ---------------------------------------------------------------------------

describe('AC4: nośniki konfiguracji LAN są nazwane po źródłach i wolne od poświadczeń', () => {
  const inventory = readArtifact(INVENTORY_PATH);

  it('każdy nośnik lan_config występuje w nazwanym pliku źródłowym', () => {
    const lan = inventory.lan_config as { [k: string]: YamlValue };
    const items = (lan.items as { [k: string]: YamlValue }[] | null) ?? [];
    expect(items.length).toBeGreaterThan(0);
    const names = items.map(i => String(i.name));
    for (const required of [
      'VITE_MEDUSA_BACKEND_URL',
      'VITE_MEDUSA_BASE',
      'VITE_PUBLISHABLE_API_KEY',
      '__BACKEND_URL__',
      '__PUBLISHABLE_API_KEY__',
      'x-publishable-api-key',
      'x-seller-id',
      'connect-src',
      'VENDOR_CORS',
      '/vendor/* matcher'
    ]) {
      expect(names, `brak nośnika ${required}`).toContain(required);
    }
    const problems: string[] = [];
    for (const it of items) {
      const anchor = String(it.anchor_file);
      const abs = anchor.startsWith('GP/vendor-panel/')
        ? path.join(PANEL_ROOT, anchor.replace(/^GP\/vendor-panel\//, ''))
        : path.join(SUPER_ROOT, anchor);
      if (!existsSync(abs)) {
        problems.push(`${String(it.name)}: plik ${anchor} nie istnieje`);
        continue;
      }
      const sourceName = String(it.name).replace(/ matcher$/, '');
      if (!readFileSync(abs, 'utf8').includes(sourceName))
        problems.push(`${String(it.name)}: nazwa nie występuje w ${anchor}`);
    }
    expect(problems).toEqual([]);
    expect(lan.measured_runtime === true || typeof lan.not_measured_reason === 'string').toBe(true);
  });

  it('artefakty nie zawierają wartości wyglądających na poświadczenia', () => {
    for (const p of [SCREEN_SET_PATH, INVENTORY_PATH]) {
      const text = readFileSync(p, 'utf8');
      const hits = SECRET_PATTERNS.filter(re => re.test(text)).map(
        re => `${path.basename(p)}: ${re.source}`
      );
      expect(hits).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Test-the-test parsera YAML (żeby zielone parity nie było skutkiem pustego odczytu)
// ---------------------------------------------------------------------------

describe('parser podzbioru YAML', () => {
  it('round-trip dokumentu z listą map, pustymi listami i cudzysłowami', () => {
    const doc: YamlValue = {
      a: 'x: y',
      b: ['p', "q's", ''],
      c: [],
      d: { e: 1, f: true, g: null },
      h: [
        { k: 'v', l: [1, 2] },
        { k: 'w', m: {} }
      ],
      i: '-leading'
    };
    const text = dumpYamlSubset(doc);
    expect(parseYamlSubset(text)).toEqual(doc);
  });
  it('czyta styl PyYAML safe_dump (lista na poziomie klucza)', () => {
    const text = [
      'routes:',
      '- method: GET',
      '  canonical_path: /vendor/x',
      '  consumers:',
      '  - file: a.ts',
      '    line: 3',
      '  transport:',
      '  - fetchQuery',
      'count: 1',
      ''
    ].join('\n');
    expect(parseYamlSubset(text)).toEqual({
      routes: [
        {
          method: 'GET',
          canonical_path: '/vendor/x',
          consumers: [{ file: 'a.ts', line: 3 }],
          transport: ['fetchQuery']
        }
      ],
      count: 1
    });
  });
  it('odrzuca składnię spoza podzbioru zamiast cicho zwracać pusty dokument', () => {
    expect(() => parseYamlSubset('a: &anchor x\n')).toThrow();
    expect(() => parseYamlSubset('a: |\n  block\n')).toThrow();
  });
});
