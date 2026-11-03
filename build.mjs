// Packs the extension into dist/<name>-<version>.xpi: a zip with forward-slash paths, which Firefox
// requires (PowerShell 5.1's Compress-Archive writes backslashes). No dependencies; node >= 22.2.
// Usage: node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

// Only what the manifest and popup load, so README, build.mjs and stray files stay out.
const files = [
  'manifest.json',
  ...manifest.content_scripts.flatMap((s) => [...(s.js ?? []), ...(s.css ?? [])]),
  manifest.action.default_popup,
  'popup.js',
  ...Object.values(manifest.icons ?? {}),
  ...(typeof manifest.action.default_icon === 'string' ? [manifest.action.default_icon] : Object.values(manifest.action.default_icon ?? {})),
];
const names = [...new Set(files)].sort();

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
// Fixed timestamp (1980-01-01) so the same sources always give the same bytes.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

const body = [];
const central = [];
let offset = 0;
for (const name of names) {
  const data = readFileSync(join(root, name));
  const packed = deflateRawSync(data, { level: 9 });
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(DOS_TIME), u16(DOS_DATE),
    u32(crc), u32(packed.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf,
  ]);
  central.push(Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(DOS_TIME), u16(DOS_DATE),
    u32(crc), u32(packed.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0),
    u16(0), u16(0), u32(0), u32(offset), nameBuf,
  ]));
  body.push(local, packed);
  offset += local.length + packed.length;
}
const dir = Buffer.concat(central);
const end = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(names.length), u16(names.length), u32(dir.length), u32(offset), u16(0),
]);

const slug = manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const out = join(root, 'dist', `${slug}-${manifest.version}.xpi`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([...body, dir, end]));
console.log(`${out}\n${names.join('\n')}`);
