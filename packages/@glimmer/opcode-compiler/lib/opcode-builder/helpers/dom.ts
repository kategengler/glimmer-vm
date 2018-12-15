import { Option, CompileTimeLookup, ContainingMetadata } from '@glimmer/interfaces';
import { Op, MachineOp } from '@glimmer/vm';

import {
  OpcodeBuilderEncoder,
  str,
  OpcodeBuilderCompiler,
  CompileHelper,
  Block,
} from '../interfaces';
import { pushPrimitiveReference } from './vm';
import { compileArgs } from './shared';
import { EMPTY_BLOCKS } from '../../utils';

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
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  { handle, params, hash }: CompileHelper
) {
  encoder.pushMachine(MachineOp.PushFrame);
  compileArgs(encoder, resolver, compiler, meta, params, hash, EMPTY_BLOCKS, true);
  encoder.push(Op.Modifier, { type: 'handle', value: handle });
  encoder.pushMachine(MachineOp.PopFrame);
}

export function remoteElement(encoder: OpcodeBuilderEncoder, block: Block): void {
  encoder.push(Op.PushRemoteElement);
  block(encoder);
  encoder.push(Op.PopRemoteElement);
}
