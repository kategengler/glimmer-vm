import { MachineOp } from '@glimmer/vm';

import * as WireFormat from '@glimmer/wire-format';

import { expr } from './shared';
import { ExprCompilerState } from '../../syntax';

export function guardedAppend<Locator>(
  expression: WireFormat.Expression,
  trusting: boolean,
  state: ExprCompilerState<Locator>
): void {
  let { encoder } = state;

  encoder.pushMachine(MachineOp.PushFrame);

  expr(expression, state);

  encoder.pushMachine(MachineOp.InvokeStatic, encoder.stdlib.getAppend(trusting));

  encoder.pushMachine(MachineOp.PopFrame);
}
