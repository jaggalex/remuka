import {generateKeyPairSync,createHash,verify} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {buildArtifact} from './support-knowledge.mjs';

test('exports only reviewed guide/help Markdown, reproducibly signs their hashes and release',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const metadata={commit:'a'.repeat(40),release:'fixture-v1',builtAt:'2026-01-01T00:00:00Z',privateKey};
  const {archive,manifest}=buildArtifact(metadata);
  const files=JSON.parse(gunzipSync(archive));
  expect(manifest.documents.length).toBeGreaterThan(200);
  expect(buildArtifact(metadata).manifest).toEqual(manifest);
  const {signature,manifest_id,...payload}=manifest;
  function canonical(v) {
    if (Array.isArray(v)) return '['+v.map(canonical).join(',')+']';
    if (v && typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
    return JSON.stringify(v);
  }
  const bytes=Buffer.from(canonical(payload));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest_id);
  expect(verify(null,bytes,publicKey,Buffer.from(signature,'base64'))).toBe(true);
  expect(Object.keys(files).sort()).toEqual(manifest.documents.map(doc=>doc.path));
  for (const doc of manifest.documents) {
    expect(doc.path).toMatch(/^(guide\/[\w-]+\/[\w-]+|content\/help\/[\w.-]+)\/(en|ru)\.md$/);
    expect(files[doc.path]).toBe(readFileSync(new URL('../'+doc.path,import.meta.url),'utf8'));
  }
});
