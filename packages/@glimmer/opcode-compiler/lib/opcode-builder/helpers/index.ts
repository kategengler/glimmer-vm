import { Option, CompileTimeLookup, ContainingMetadata } from '@glimmer/interfaces';
import { Op, $s0, MachineOp, $v0, SavedRegister } from '@glimmer/vm';
import {
  Block,
  strArray,
  arr,
  CompileHelper,
  serializable,
  OpcodeBuilderEncoder,
  OpcodeBuilderCompiler,
} from '../interfaces';
import { EMPTY_BLOCKS } from '../../utils';
import { compileArgs } from './shared';
import { invokePreparedComponent } from './components';
import { reserveTarget } from './labels';

export function main(encoder: OpcodeBuilderEncoder) {
  encoder.push(Op.Main, $s0);
  invokePreparedComponent(encoder, false, false, true);
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

export function helper<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  { handle, params, hash }: CompileHelper
) {
  encoder.pushMachine(MachineOp.PushFrame);
  compileArgs(encoder, resolver, compiler, meta, params, hash, EMPTY_BLOCKS, true);
  encoder.push(Op.Helper, { type: 'handle', value: handle });
  encoder.pushMachine(MachineOp.PopFrame);
  encoder.push(Op.Fetch, $v0);
}

export function list(encoder: OpcodeBuilderEncoder, start: string, block: Block): void {
  reserveTarget(encoder, Op.EnterList, start);
  block(encoder);
  encoder.push(Op.ExitList);
}

export function invokePartial(
  encoder: OpcodeBuilderEncoder,
  referrer: unknown,
  symbols: string[],
  evalInfo: number[]
) {
  let _meta = serializable(referrer);
  let _symbols = strArray(symbols);
  let _evalInfo = arr(evalInfo);

  encoder.push(Op.InvokePartial, _meta, _symbols, _evalInfo);
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
