import { OpcodeSize } from '@glimmer/encoder';
import {
  OpcodeBuilderEncoder,
  num,
  bool,
  str,
  Block,
  CompileHelper,
  strArray,
  arr,
} from '../interfaces';
import { PrimitiveType } from '@glimmer/program';
import { Op, MachineOp, SavedRegister, $v0 } from '@glimmer/vm';
import { Primitive } from '../../interfaces';
import { reserveTarget } from './labels';
import { Option, BuilderOperand } from '@glimmer/interfaces';
import { compileArgs } from './shared';
import { EMPTY_BLOCKS } from '../../utils';
import { ExprCompilerState } from '../../syntax';

export function pushPrimitiveReference(encoder: OpcodeBuilderEncoder, value: Primitive) {
  primitive(encoder, value);
  encoder.push(Op.PrimitiveReference);
}

export function primitive(encoder: OpcodeBuilderEncoder, _primitive: Primitive) {
  let type: PrimitiveType = PrimitiveType.NUMBER;
  let primitive: BuilderOperand;
  switch (typeof _primitive) {
    case 'number':
      if ((_primitive as number) % 1 === 0) {
        if ((_primitive as number) > -1) {
          primitive = _primitive;
        } else {
          primitive = num(_primitive);
          type = PrimitiveType.NEGATIVE;
        }
      } else {
        primitive = num(_primitive);
        type = PrimitiveType.FLOAT;
      }
      break;
    case 'string':
      primitive = str(_primitive);
      type = PrimitiveType.STRING;
      break;
    case 'boolean':
      primitive = bool(_primitive);
      type = PrimitiveType.BOOLEAN_OR_VOID;
      break;
    case 'object':
      // assume null
      primitive = 2;
      type = PrimitiveType.BOOLEAN_OR_VOID;
      break;
    case 'undefined':
      primitive = 3;
      type = PrimitiveType.BOOLEAN_OR_VOID;
      break;
    default:
      throw new Error('Invalid primitive passed to pushPrimitive');
  }

  let encoded = encoder.operand(primitive);

  let immediate = sizeImmediate(encoder, (encoded << 3) | type, primitive);
  encoder.push(Op.Primitive, immediate);
}

export function hasBlockParams(encoder: OpcodeBuilderEncoder, to: number) {
  encoder.push(Op.GetBlock, to);
  if (!encoder.isEager) encoder.push(Op.CompileBlock);
  encoder.push(Op.HasBlockParams);
}

function sizeImmediate(encoder: OpcodeBuilderEncoder, shifted: number, primitive: BuilderOperand) {
  if (shifted >= OpcodeSize.MAX_SIZE || shifted < 0) {
    if (typeof primitive !== 'number') {
      throw new Error(
        "This condition should only be possible if the primitive isn't already a constant"
      );
    }

    return (encoder.operand(num(primitive as number)) << 3) | PrimitiveType.BIG_NUM;
  }

  return shifted;
}

export function frame(encoder: OpcodeBuilderEncoder, block: Block): void {
  encoder.pushMachine(MachineOp.PushFrame);
  block(encoder);
  encoder.pushMachine(MachineOp.PopFrame);
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
  reserveTarget(encoder, Op.EnterList, start);
  block(encoder);
  encoder.push(Op.ExitList);
}

export function helper<Locator>(
  state: ExprCompilerState<Locator>,
  { handle, params, hash }: CompileHelper
) {
  let { encoder } = state;

  encoder.pushMachine(MachineOp.PushFrame);
  compileArgs(params, hash, EMPTY_BLOCKS, true, state);
  encoder.push(Op.Helper, { type: 'handle', value: handle });
  encoder.pushMachine(MachineOp.PopFrame);
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

export function startDebugger(
  encoder: OpcodeBuilderEncoder,
  symbols: string[],
  evalInfo: number[]
) {
  encoder.push(Op.Debugger, strArray(symbols), arr(evalInfo));
}
