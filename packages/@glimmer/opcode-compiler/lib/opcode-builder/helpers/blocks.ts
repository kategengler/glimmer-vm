import {
  CompileTimeLookup,
  ContainingMetadata,
  Option,
  CompilableBlock,
  SymbolTable,
  CompilableTemplate,
  NamedBlocks,
} from '@glimmer/interfaces';
import * as WireFormat from '@glimmer/wire-format';
import { Op, MachineOp, $fp } from '@glimmer/vm';
import { EMPTY_BLOCKS, CompilableBlockImpl, PLACEHOLDER_HANDLE } from '@glimmer/opcode-compiler';

import { OpcodeBuilderEncoder, OpcodeBuilderCompiler } from '../interfaces';

import { compileArgs } from './shared';
import { primitive } from './vm';
import { NamedBlocksImpl } from '../../utils';

export function invokeStatic(
  encoder: OpcodeBuilderEncoder,
  compilable: CompilableTemplate,
  isEager: boolean,
  isComponentAttrs: boolean
) {
  if (isEager) {
    let handle = compilable.compile(isComponentAttrs);

    // If the handle for the invoked component is not yet known (for example,
    // because this is a recursive invocation and we're still compiling), push a
    // function that will produce the correct handle when the heap is
    // serialized.
    if (handle === PLACEHOLDER_HANDLE) {
      encoder.pushMachine(MachineOp.InvokeStatic, () => compilable.compile(isComponentAttrs));
    } else {
      encoder.pushMachine(MachineOp.InvokeStatic, handle);
    }
  } else {
    encoder.push(Op.Constant, { type: 'other', value: compilable });
    encoder.push(Op.CompileBlock);
    encoder.pushMachine(MachineOp.InvokeVirtual);
  }
}

export function yieldBlock<Locator>(
  to: number,
  params: Option<WireFormat.Core.Params>,
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>
) {
  compileArgs(params, null, EMPTY_BLOCKS, false, { encoder, resolver, meta });
  encoder.push(Op.GetBlock, to);
  if (!compiler.isEager) encoder.push(Op.CompileBlock);
  encoder.push(Op.InvokeYield);
  encoder.push(Op.PopScope);
  encoder.pushMachine(MachineOp.PopFrame);
}

export function pushYieldableBlock(
  encoder: OpcodeBuilderEncoder,
  block: Option<CompilableBlock>,
  isComponentAttrs: boolean
) {
  pushSymbolTable(encoder, block && block.symbolTable);
  encoder.push(Op.PushBlockScope);

  if (block === null) {
    primitive(encoder, null);
  } else if (encoder.isEager) {
    primitive(encoder, block.compile(isComponentAttrs));
  } else {
    encoder.push(Op.Constant, { type: 'other', value: block });
  }
}

export function pushCompilable(
  encoder: OpcodeBuilderEncoder,
  block: Option<CompilableTemplate>,
  isEager: boolean,
  isComponentAttrs: boolean
) {
  if (block === null) {
    primitive(encoder, null);
  } else if (isEager) {
    primitive(encoder, block.compile(isComponentAttrs));
  } else {
    encoder.push(Op.Constant, { type: 'other', value: block });
  }
}

export function invokeStaticBlock<Locator>(
  encoder: OpcodeBuilderEncoder,
  compiler: OpcodeBuilderCompiler<Locator>,
  block: CompilableBlock,
  isComponentAttrs: boolean,
  callerCount = 0
): void {
  let { parameters } = block.symbolTable;
  let calleeCount = parameters.length;
  let count = Math.min(callerCount, calleeCount);

  encoder.pushMachine(MachineOp.PushFrame);

  if (count) {
    encoder.push(Op.ChildScope);

    for (let i = 0; i < count; i++) {
      encoder.push(Op.Dup, $fp, callerCount - i);
      encoder.push(Op.SetVariable, parameters[i]);
    }
  }

  pushCompilable(encoder, block, compiler.isEager, isComponentAttrs);
  if (!compiler.isEager) encoder.push(Op.CompileBlock);
  encoder.pushMachine(MachineOp.InvokeVirtual);

  if (count) {
    encoder.push(Op.PopScope);
  }

  encoder.pushMachine(MachineOp.PopFrame);
}

export function pushSymbolTable(encoder: OpcodeBuilderEncoder, table: Option<SymbolTable>): void {
  if (table) {
    encoder.push(Op.PushSymbolTable, { type: 'serializable', value: table });
  } else {
    primitive(encoder, null);
  }
}

export function inlineBlock<Locator>(
  block: WireFormat.SerializedInlineBlock,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  isComponentAttrs: boolean
): CompilableBlockImpl<Locator> {
  return new CompilableBlockImpl(compiler, block, meta, isComponentAttrs);
}

export function templates<Locator>(
  blocks: WireFormat.Core.Blocks,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>
): NamedBlocks {
  return NamedBlocksImpl.fromWireFormat(blocks, block => {
    if (!block) return null;

    return inlineBlock(block, compiler, meta, false);
  });
}
