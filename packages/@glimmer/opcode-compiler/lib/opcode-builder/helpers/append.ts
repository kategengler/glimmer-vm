import { MachineOp } from '@glimmer/vm';

import { CompileTimeLookup, ContainingMetadata } from '@glimmer/interfaces';
import * as WireFormat from '@glimmer/wire-format';

import { OpcodeBuilderEncoder, OpcodeBuilderCompiler } from '../interfaces';
import { expr } from './shared';

export function guardedAppend<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  expression: WireFormat.Expression,
  trusting: boolean
): void {
  encoder.pushMachine(MachineOp.PushFrame);

  expr(encoder, resolver, compiler, meta, expression);

  encoder.pushMachine(MachineOp.InvokeStatic, compiler.stdLib.getAppend(trusting));

  encoder.pushMachine(MachineOp.PopFrame);
}
