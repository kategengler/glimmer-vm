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

  encoder.push(MachineOp.PushFrame);
  expr(expression, state);
  encoder.push(MachineOp.InvokeStatic, {
    type: 'stdlib',
    value: trusting ? 'trusting-append' : 'cautious-append',
  });
  encoder.push(MachineOp.PopFrame);
}
