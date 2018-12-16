import { MachineOp } from '@glimmer/vm';

import { CompileTimeLookup, ContainingMetadata } from '@glimmer/interfaces';
import * as WireFormat from '@glimmer/wire-format';

import { OpcodeBuilderEncoder } from '../interfaces';
import { expr } from './shared';

export function guardedAppend<Locator>(
  expression: WireFormat.Expression,
  trusting: boolean,
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  meta: ContainingMetadata<Locator>,
  isEager: boolean
): void {
  encoder.pushMachine(MachineOp.PushFrame);

  expr(expression, encoder, resolver, meta, isEager);

  encoder.pushMachine(MachineOp.InvokeStatic, encoder.stdlib.getAppend(trusting));

  encoder.pushMachine(MachineOp.PopFrame);
}
