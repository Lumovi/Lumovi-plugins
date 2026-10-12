/**
 * Checks the types of the plugins' code and the runtime (src/), and of the tests' own plugin
 * (tests/code), with the pinned Lumovi checkout's TypeScript: strict, and only the syntax Node
 * runs as it's written (types erased, nothing compiled), as the tests run it.
 *
 *   node scripts/types.mjs [lumovi]
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { checkoutAt } from './lumovi.mjs'

const checkout = checkoutAt(process.argv[2])
const ts = createRequire(join(checkout, 'package.json'))('typescript')
const files = ['src', 'tests/code'].flatMap((folder) => ts.sys.readDirectory(folder, ['.ts']))
const options = {
  strict: true,
  noUncheckedIndexedAccess: true,
  erasableSyntaxOnly: true,
  allowImportingTsExtensions: true,
  // (The scripts a test imports are JavaScript: read for their types, not checked.)
  allowJs: true,
  checkJs: false,
  noEmit: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2023.d.ts'],
  types: ['node'],
  typeRoots: [join(checkout, 'node_modules/@types')],
  skipLibCheck: true,
}
const host = ts.createCompilerHost(options)
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(files, options, host))
if (diagnostics.length > 0) {
  console.error(ts.formatDiagnostics(diagnostics, host))
  process.exit(1)
}
console.log(`${files.length} files’ types hold.`)
