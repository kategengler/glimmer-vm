import {
  OpcodeBuilderEncoder,
  num,
  bool,
  str,
  Block,
  CompileHelper,
  label,
  prim,
} from '../interfaces';
import { SavedRegister, $v0 } from '@glimmer/vm';
import { Primitive } from '../../interfaces';
import {
  Option,
  Op,
  MachineOp,
  BuilderOp,
  CompileActions,
  PrimitiveType,
  SingleBuilderOperand,
} from '@glimmer/interfaces';
import { compileArgs } from './shared';
import { EMPTY_BLOCKS } from '../../utils';
import { ExprCompilerState } from '../../syntax';
import { op } from '../encoder';

export function pushPrimitiveReference(value: Primitive): CompileActions {
  return [primitive(value), op(Op.PrimitiveReference)];
}

export function primitive(_primitive: Primitive): BuilderOp {
  let type: PrimitiveType = PrimitiveType.NUMBER;
  let p: SingleBuilderOperand;
  switch (typeof _primitive) {
    case 'number':
      if ((_primitive as number) % 1 === 0) {
        if ((_primitive as number) > -1) {
          p = _primitive;
        } else {
          p = num(_primitive);
          type = PrimitiveType.NEGATIVE;
        }
      } else {
        p = num(_primitive);
        type = PrimitiveType.FLOAT;
      }
      break;
    case 'string':
      p = str(_primitive);
      type = PrimitiveType.STRING;
      break;
    case 'boolean':
      p = bool(_primitive);
      type = PrimitiveType.BOOLEAN_OR_VOID;
      break;
    case 'object':
      // assume null
      p = 2;
      type = PrimitiveType.BOOLEAN_OR_VOID;
      break;
    case 'undefined':
      p = 3;
      type = PrimitiveType.BOOLEAN_OR_VOID;
      break;
    default:
      throw new Error('Invalid primitive passed to pushPrimitive');
  }

  return op(Op.Primitive, prim(p, type));
}

export function hasBlockParams(encoder: OpcodeBuilderEncoder, to: number) {
  encoder.push(Op.GetBlock, to);
  if (!encoder.isEager) encoder.push(Op.CompileBlock);
  encoder.push(Op.HasBlockParams);
}

export function frame(encoder: OpcodeBuilderEncoder, block: Block): void {
  encoder.push(MachineOp.PushFrame);
  block(encoder);
  encoder.push(MachineOp.PopFrame);
}

export function withSavedRegister(
  encoder: OpcodeBuilderEncoder,
  register: SavedRegister,
  block: Block
): void {
  encoder.push(Op.Fetch, register);
  block(encoder);
  encoder.push(Op.Load, register);
}

export function list(encoder: OpcodeBuilderEncoder, start: string, block: Block): void {
  encoder.push(Op.EnterList, label(start));
  block(encoder);
  encoder.push(Op.ExitList);
}

export function helper<Locator>(
  state: ExprCompilerState<Locator>,
  { handle, params, hash }: CompileHelper
) {
  let { encoder } = state;

  encoder.push(MachineOp.PushFrame);
  compileArgs(params, hash, EMPTY_BLOCKS, true, state);
  encoder.push(Op.Helper, { type: 'handle', value: handle });
  encoder.push(MachineOp.PopFrame);
  encoder.push(Op.Fetch, $v0);
}

export function dynamicScope(encoder: OpcodeBuilderEncoder, names: Option<string[]>, block: Block) {
  encoder.push(Op.PushDynamicScope);
  if (names && names.length) {
    encoder.push(Op.BindDynamicScope, { type: 'string-array', value: names });
  }
  block(encoder);
  encoder.push(Op.PopDynamicScope);
}
