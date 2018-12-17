import { Option } from '@glimmer/interfaces';
import { Op, MachineOp } from '@glimmer/vm';

import { OpcodeBuilderEncoder, str, CompileHelper, Block } from '../interfaces';
import { compileArgs } from './shared';
import { EMPTY_BLOCKS } from '../../utils';
import { ExprCompilerState } from '../../syntax';

export function staticAttr(
  encoder: OpcodeBuilderEncoder,
  name: string,
  _namespace: Option<string>,
  value: string
): void {
  const namespace = _namespace ? str(_namespace) : 0;

  encoder.push(Op.StaticAttr, str(name), str(value), namespace);
}

export function modifier<Locator>(
  state: ExprCompilerState<Locator>,
  { handle, params, hash }: CompileHelper
) {
  let { encoder } = state;

  encoder.pushMachine(MachineOp.PushFrame);
  compileArgs(params, hash, EMPTY_BLOCKS, true, state);
  encoder.push(Op.Modifier, { type: 'handle', value: handle });
  encoder.pushMachine(MachineOp.PopFrame);
}

export function remoteElement(encoder: OpcodeBuilderEncoder, block: Block): void {
  encoder.push(Op.PushRemoteElement);
  block(encoder);
  encoder.push(Op.PopRemoteElement);
}
