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
  HighLevelBuilderOpcode,
} from '@glimmer/interfaces';
import { EMPTY_BLOCKS } from '../../utils';
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

export function hasBlockParams(to: number, isEager: boolean): CompileActions {
  return [op(Op.GetBlock, to), isEager ? undefined : op(Op.CompileBlock), op(Op.HasBlockParams)];
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

export function helper({ handle, params, hash }: CompileHelper): CompileActions {
  return [
    op(MachineOp.PushFrame),
    op(HighLevelBuilderOpcode.Args, { params, hash, blocks: EMPTY_BLOCKS, synthetic: true }),
    op(Op.Helper, { type: 'handle', value: handle }),
    op(MachineOp.PopFrame),
    op(Op.Fetch, $v0),
  ];
}

export function dynamicScope(encoder: OpcodeBuilderEncoder, names: Option<string[]>, block: Block) {
  encoder.push(Op.PushDynamicScope);
  if (names && names.length) {
    encoder.push(Op.BindDynamicScope, { type: 'string-array', value: names });
  }
  block(encoder);
  encoder.push(Op.PopDynamicScope);
}
