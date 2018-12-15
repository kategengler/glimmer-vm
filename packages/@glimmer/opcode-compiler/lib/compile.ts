import { statementCompiler } from './syntax';
import { debugCompiler } from './compiler';
import { OpcodeBuilderImpl } from './opcode-builder/builder';
import { Statement } from '@glimmer/wire-format';
import { DEBUG } from '@glimmer/local-debug-flags';
import { OpcodeBuilderCompiler } from './opcode-builder/interfaces';

export function compile<Locator>(
  statements: Statement[],
  builder: OpcodeBuilderImpl<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>
): number {
  let sCompiler = statementCompiler();

  for (let i = 0; i < statements.length; i++) {
    sCompiler.compile(statements[i], builder);
  }

  let handle = builder.commit();

  if (DEBUG) {
    debugCompiler(compiler as OpcodeBuilderCompiler<Locator>, handle);
  }

  return handle;
}
