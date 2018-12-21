import { MachineOp } from '@glimmer/vm';

import { ExprCompilerState } from '../../syntax';
import { op } from '../encoder';
import { HighLevelBuilderOp, WireFormat } from '@glimmer/interfaces';

export function guardedAppend<Locator>(
  expression: WireFormat.Expression,
  trusting: boolean,
  state: ExprCompilerState<Locator>
): void {
  let { encoder } = state;

  encoder.concat([
    op(MachineOp.PushFrame),
    op(HighLevelBuilderOp.Expr, expression),
    op(MachineOp.InvokeStatic, {
      type: 'stdlib',
      value: trusting ? 'trusting-append' : 'cautious-append',
    }),
    op(MachineOp.PopFrame),
  ]);

  // encoder.push(MachineOp.PushFrame);
  // expr(expression, state);
  // encoder.push(MachineOp.InvokeStatic, {
  //   type: 'stdlib',
  //   value: trusting ? 'trusting-append' : 'cautious-append',
  // });
  // encoder.push(MachineOp.PopFrame);
}
