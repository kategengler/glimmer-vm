import { Option } from '@glimmer/interfaces';
import { Op, MachineOp } from '@glimmer/vm';

import { OpcodeBuilderEncoder, str, CompileHelper, Block } from '../interfaces';
import { pushPrimitiveReference } from './vm';
import { compileArgs } from './shared';
import { EMPTY_BLOCKS } from '../../utils';
import { ExprCompilerState } from '../../syntax';

export function staticAttr(
  encoder: OpcodeBuilderEncoder,
  _name: string,
  _namespace: Option<string>,
  _value: string
): void {
  const name = str(_name);
  const namespace = _namespace ? str(_namespace) : 0;

  if (encoder.isComponentAttrs) {
    pushPrimitiveReference(encoder, _value);
    encoder.push(Op.ComponentAttr, name, 1, namespace);
  } else {
    let value = str(_value);
    encoder.push(Op.StaticAttr, name, value, namespace);
  }
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
