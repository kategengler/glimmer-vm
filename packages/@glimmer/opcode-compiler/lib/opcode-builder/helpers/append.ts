import { op } from '../encoder';
import { HighLevelBuilderOp, WireFormat, MachineOp, BuilderOps } from '@glimmer/interfaces';

export function guardedAppend(expression: WireFormat.Expression, trusting: boolean): BuilderOps {
  return [
    op(MachineOp.PushFrame),
    op(HighLevelBuilderOp.Expr, { type: 'expr', value: expression }),
    op(MachineOp.InvokeStatic, {
      type: 'stdlib',
      value: trusting ? 'trusting-append' : 'cautious-append',
    }),
    op(MachineOp.PopFrame),
  ];
}
