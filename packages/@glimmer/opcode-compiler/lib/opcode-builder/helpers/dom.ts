import { Option, MachineOp, Op, HighLevelBuilderOp, CompileAction } from '@glimmer/interfaces';

import { OpcodeBuilderEncoder, str, CompileHelper, Block, args, handle } from '../interfaces';
import { EMPTY_BLOCKS } from '../../utils';
import { op } from '../encoder';

export function staticAttr(name: string, _namespace: Option<string>, value: string): CompileAction {
  const namespace = _namespace ? str(_namespace) : 0;

  return op(Op.StaticAttr, str(name), str(value), namespace);
}

export function modifier({ handle: h, params, hash }: CompileHelper) {
  return [
    op(MachineOp.PushFrame),
    op(HighLevelBuilderOp.Args, args({ params, hash, blocks: EMPTY_BLOCKS, synthetic: true })),
    op(Op.Modifier, handle(h)),
    op(MachineOp.PopFrame),
  ];
}

export function remoteElement(encoder: OpcodeBuilderEncoder, block: Block): void {
  encoder.push(Op.PushRemoteElement);
  block(encoder);
  encoder.push(Op.PopRemoteElement);
}
