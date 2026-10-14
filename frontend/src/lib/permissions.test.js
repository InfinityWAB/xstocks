import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STOCK_ACCESS_PERMISSION } from './permissions.js'

const manifest = readFileSync(new URL('../../../plugin.yaml', import.meta.url), 'utf8')
const declared = [...manifest.matchAll(/^\s*- name:\s*(\S+)\s*$/gm)].map(m => m[1])
const mainSrc = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')

test('la permission d’accès est déclarée dans plugin.yaml', () => {
  assert.ok(declared.includes(STOCK_ACCESS_PERMISSION), `${STOCK_ACCESS_PERMISSION} absente du manifeste`)
})
test('main.jsx utilise la permission déclarée, pas « stock:products:read »', () => {
  assert.doesNotMatch(mainSrc, /['"]stock:products:read['"]/)
  const used = [...mainSrc.matchAll(/permission:\s*([^,}\s]+)/g)].map(m => m[1])
  assert.ok(used.length >= 2)
  for (const u of used) assert.equal(u, 'STOCK_ACCESS_PERMISSION')
})
