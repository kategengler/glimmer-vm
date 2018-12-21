import { Option, MachineOp, Op } from '@glimmer/interfaces';

import { OpcodeBuilderEncoder, str, CompileHelper, Block } from '../interfaces';
import { compileArgs } from './shared';
import { EMPTY_BLOCKS } from '../../utils';
import { ExprCompilerState, CompileAction } from '../../syntax';
import { op } from '../encoder';

export function staticAttr(name: string, _namespace: Option<string>, value: string): CompileAction {
  const namespace = _namespace ? str(_namespace) : 0;

  return op(Op.StaticAttr, str(name), str(value), namespace);
}

export function modifier<Locator>(
  state: ExprCompilerState<Locator>,
  { handle, params, hash }: CompileHelper
) {
  let { encoder } = state;

  encoder.push(MachineOp.PushFrame);
  compileArgs(params, hash, EMPTY_BLOCKS, true, state);
  encoder.push(Op.Modifier, { type: 'handle', value: handle });
  encoder.push(MachineOp.PopFrame);
}

export function remoteElement(encoder: OpcodeBuilderEncoder, block: Block): void {
  encoder.push(Op.PushRemoteElement);
  block(encoder);
  encoder.push(Op.PopRemoteElement);
}
