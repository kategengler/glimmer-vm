import { op } from '../encoder';
import { HighLevelBuilderOpcode, WireFormat, MachineOp, BuilderOp } from '@glimmer/interfaces';

export function guardedAppend(expression: WireFormat.Expression, trusting: boolean): BuilderOp[] {
  return [
    op(MachineOp.PushFrame),
    op(HighLevelBuilderOpcode.Expr, expression),
    op(MachineOp.InvokeStatic, {
      type: 'stdlib',
      value: trusting ? 'trusting-append' : 'cautious-append',
    }),
    op(MachineOp.PopFrame),
  ];
}
