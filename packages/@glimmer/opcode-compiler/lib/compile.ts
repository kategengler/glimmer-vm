import { statementCompiler } from './syntax';
import { debugCompiler } from './compiler';
import { Statement } from '@glimmer/wire-format';
import { DEBUG } from '@glimmer/local-debug-flags';
import { OpcodeBuilderCompiler } from './opcode-builder/interfaces';
import { ContainingMetadata } from '@glimmer/interfaces';
import builder from './opcode-builder/builder';

export function compile<Locator>(
  statements: Statement[],
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>
): number {
  let b = builder(compiler, meta);

  let sCompiler = statementCompiler();

  for (let i = 0; i < statements.length; i++) {
    sCompiler.compile(statements[i], b);
  }

  let handle = b.encoder.commit(compiler, meta.size);

  if (DEBUG) {
    debugCompiler(compiler as OpcodeBuilderCompiler<Locator>, handle);
  }

  return handle;
}
