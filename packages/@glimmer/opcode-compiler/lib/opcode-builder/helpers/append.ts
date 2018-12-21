import { ExprCompilerState } from '../../syntax';
import { op } from '../encoder';
import { HighLevelBuilderOp, WireFormat, MachineOp } from '@glimmer/interfaces';

export function guardedAppend<Locator>(
  expression: WireFormat.Expression,
  trusting: boolean,
  state: ExprCompilerState<Locator>
): void {
  let { encoder } = state;

  encoder.concat([
    op(MachineOp.PushFrame),
    op(HighLevelBuilderOp.Expr, { type: 'expr', value: expression }),
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
