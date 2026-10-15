import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeBytes, parseCsv, detectDelimiter, readImportFile, classifyFileName, MAX_IMPORT_ROWS } from './import-file.js'

const enc = (s) => new TextEncoder().encode(s)
const latin1 = (s) => Uint8Array.from([...s].map(c => { const k = c.charCodeAt(0); return k < 256 ? k : 63 }))

test('decodeBytes : UTF-8 avec et sans BOM', () => {
  assert.deepEqual(decodeBytes(enc('Désignation')), { text: 'Désignation', encoding: 'UTF-8' })
  const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('Désignation')])
  assert.deepEqual(decodeBytes(bom), { text: 'Désignation', encoding: 'UTF-8 (BOM)' })
})
test('decodeBytes : repli Windows-1252 si UTF-8 invalide (é, €)', () => {
  const r = decodeBytes(Uint8Array.from([0x44, 0xe9, 0x73, 0x69, 0x67, 0x6e, 0x80]))
  assert.equal(r.encoding, 'Windows-1252')
  assert.equal(r.text, 'Désign€')
})
test('decodeBytes : UTF-16 avec BOM (Excel « Texte Unicode »)', () => {
  const u = new Uint8Array([0xff, 0xfe, 0x43, 0x00, 0xe9, 0x00])
  assert.equal(decodeBytes(u).text, 'Cé')
})

test('parseCsv : guillemets, guillemets doublés, retour ligne dans une cellule', () => {
  const { records } = parseCsv('a;b\n"x;1";"dit ""oui"""\n"deux\nlignes";z\nk;l', ';')
  assert.deepEqual(records.map(r => r.cells), [['a', 'b'], ['x;1', 'dit "oui"'], ['deux\nlignes', 'z'], ['k', 'l']])
  assert.deepEqual(records.map(r => r.line), [1, 2, 3, 5])
})
test('parseCsv : CRLF, CR seul, dernière ligne sans saut, guillemet au milieu = littéral', () => {
  const { records } = parseCsv('a;b\r\n5" clou;2\rz;3', ';')
  assert.deepEqual(records.map(r => r.cells), [['a', 'b'], ['5" clou', '2'], ['z', '3']])
  assert.deepEqual(records.map(r => r.line), [1, 2, 3])
})
test('parseCsv : cellules vides, ligne finale vide, guillemet non fermé signalé', () => {
  assert.deepEqual(parseCsv('a;;c\n', ';').records.map(r => r.cells), [['a', '', 'c']])
  assert.equal(parseCsv('a;"b\nc', ';').unterminatedQuoteLine, 1)
})

test('detectDelimiter : ; , tabulation, et virgules décimales ne trompent pas', () => {
  assert.equal(detectDelimiter('Code;Nom;Prix\n001;Clou;1 234,50\n002;Vis;2,5'), ';')
  assert.equal(detectDelimiter('Code,Nom,Prix\n001,Clou,1234.5\n002,Vis,2.5'), ',')
  assert.equal(detectDelimiter('Code\tNom\tPrix\n001\tClou\t1,5\n002\tVis\t2,5'), '\t')
  assert.equal(detectDelimiter('Code,Nom\n001,"Clou, 5 cm"\n002,Vis'), ',')
  assert.equal(detectDelimiter('un seul mot'), ';')
})

test('readImportFile : zéros de tête conservés, tout reste texte', () => {
  const r = readImportFile(enc('Code;Code-barres;Prix\n00123;0061234500012;1 234,50\n0007;3;0,5'))
  assert.deepEqual(r.headers, ['Code', 'Code-barres', 'Prix'])
  assert.deepEqual(r.rows[0], { line: 2, cells: ['00123', '0061234500012', '1 234,50'] })
  assert.equal(typeof r.rows[1].cells[1], 'string')
  assert.equal(r.rows[1].cells[0], '0007')
})
test('readImportFile : lignes vides supprimées, numéros de ligne du fichier', () => {
  const r = readImportFile(enc('Code;Nom\n\n001;A\n;\n   ;  \n002;B\n'))
  assert.deepEqual(r.rows.map(x => x.line), [3, 6])
  assert.equal(r.blankLines, 3)
  assert.equal(r.headerLine, 1)
})
test('readImportFile : retour ligne dans une cellule décale les numéros suivants', () => {
  const r = readImportFile(enc('Code;Nom\n001;"A\nB"\n002;C'))
  assert.deepEqual(r.rows.map(x => x.line), [2, 4])
  assert.equal(r.rows[0].cells[1], 'A\nB')
})
test('readImportFile : Windows-1252 + ; + virgules décimales', () => {
  const r = readImportFile(latin1('Désignation;Prix de vente\nBoîte de clous;1 234,50\nÉcrou;0,75\n'))
  assert.equal(r.encoding, 'Windows-1252')
  assert.equal(r.delimiter, ';')
  assert.deepEqual(r.headers, ['Désignation', 'Prix de vente'])
  assert.equal(r.rows[0].cells[0], 'Boîte de clous')
  assert.equal(r.rows[1].cells[0], 'Écrou')
})
test('readImportFile : BOM retiré de l\'en-tête, NBSP des milliers -> espace', () => {
  const r = readImportFile(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('Code;Prix\n1;1 234,5')]))
  assert.equal(r.headers[0], 'Code')
  assert.equal(r.rows[0].cells[1], '1 234,5')
})
test('readImportFile : sep=; d\'Excel, lignes trop courtes/longues', () => {
  const r = readImportFile(enc('sep=;\nCode;Nom\n1;A;extra\n2'))
  assert.equal(r.headerLine, 2)
  assert.deepEqual(r.rows.map(x => [x.line, x.cells]), [[3, ['1', 'A']], [4, ['2', '']]])
  assert.equal(r.raggedLines, 2)
})
test('readImportFile : fichier vide ou plafond de lignes', () => {
  assert.equal(readImportFile(enc('')).empty, true)
  assert.equal(readImportFile(enc('\n\n  \n')).empty, true)
  const big = 'a;b\n' + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `${i};x`).join('\n')
  assert.equal(readImportFile(enc(big)).tooMany, true)
  assert.equal(readImportFile(enc('a;b\n1;2')).tooMany, false)
})
test('classifyFileName', () => {
  assert.equal(classifyFileName('Stock.CSV'), 'text')
  assert.equal(classifyFileName('stock.xlsx'), 'spreadsheet')
  assert.equal(classifyFileName('photo.png'), 'unknown')
})
