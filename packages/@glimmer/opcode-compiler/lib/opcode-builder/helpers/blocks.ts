import {
  CompileTimeLookup,
  ContainingMetadata,
  Option,
  CompilableBlock,
  SymbolTable,
  CompilableTemplate,
  NamedBlocks,
  WireFormat,
} from '@glimmer/interfaces';
import { Op, MachineOp, $fp } from '@glimmer/vm';
import { EMPTY_BLOCKS, CompilableBlockImpl, PLACEHOLDER_HANDLE } from '@glimmer/opcode-compiler';

import { OpcodeBuilderEncoder, OpcodeBuilderCompiler } from '../interfaces';

import { compileArgs } from './shared';
import { primitive } from './vm';
import { NamedBlocksImpl } from '../../utils';

export function invokeStatic(
  encoder: OpcodeBuilderEncoder,
  compilable: CompilableTemplate,
  isEager: boolean
) {
  if (isEager) {
    let handle = compilable.compile();

    // If the handle for the invoked component is not yet known (for example,
    // because this is a recursive invocation and we're still compiling), push a
    // function that will produce the correct handle when the heap is
    // serialized.
    if (handle === PLACEHOLDER_HANDLE) {
      encoder.push(MachineOp.InvokeStatic, () => compilable.compile());
    } else {
      console.log(handle);
      encoder.push(MachineOp.InvokeStatic, handle);
    }
  } else {
    encoder.push(Op.Constant, { type: 'other', value: compilable });
    encoder.push(Op.CompileBlock);
    encoder.push(MachineOp.InvokeVirtual);
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
  encoder.push(MachineOp.PopFrame);
}

export function pushYieldableBlock(encoder: OpcodeBuilderEncoder, block: Option<CompilableBlock>) {
  pushSymbolTable(encoder, block && block.symbolTable);
  encoder.push(Op.PushBlockScope);

  if (block === null) {
    primitive(encoder, null);
  } else if (encoder.isEager) {
    primitive(encoder, block.compile());
  } else {
    encoder.push(Op.Constant, { type: 'other', value: block });
  }
}

export function pushCompilable(
  encoder: OpcodeBuilderEncoder,
  block: Option<CompilableTemplate>,
  isEager: boolean
) {
  if (block === null) {
    primitive(encoder, null);
  } else if (isEager) {
    primitive(encoder, block.compile());
  } else {
    encoder.push(Op.Constant, { type: 'other', value: block });
  }
}

export function invokeStaticBlock<Locator>(
  encoder: OpcodeBuilderEncoder,
  compiler: OpcodeBuilderCompiler<Locator>,
  block: CompilableBlock
): void {
  encoder.push(MachineOp.PushFrame);

  pushCompilable(encoder, block, compiler.isEager);
  if (!compiler.isEager) encoder.push(Op.CompileBlock);
  encoder.push(MachineOp.InvokeVirtual);

  encoder.push(MachineOp.PopFrame);
}

export function invokeStaticBlockWithStack<Locator>(
  encoder: OpcodeBuilderEncoder,
  compiler: OpcodeBuilderCompiler<Locator>,
  block: CompilableBlock,
  callerCount: number
): void {
  let { parameters } = block.symbolTable;
  let calleeCount = parameters.length;
  let count = Math.min(callerCount, calleeCount);

  encoder.push(MachineOp.PushFrame);

  if (count) {
    encoder.push(Op.ChildScope);

    for (let i = 0; i < count; i++) {
      encoder.push(Op.Dup, $fp, callerCount - i);
      encoder.push(Op.SetVariable, parameters[i]);
    }
  }

  pushCompilable(encoder, block, compiler.isEager);
  if (!compiler.isEager) encoder.push(Op.CompileBlock);
  encoder.push(MachineOp.InvokeVirtual);

  if (count) {
    encoder.push(Op.PopScope);
  }

  encoder.push(MachineOp.PopFrame);
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
  resolver: CompileTimeLookup<Locator>,
  meta: ContainingMetadata<Locator>
): CompilableBlockImpl<Locator> {
  return new CompilableBlockImpl(compiler, resolver, block, meta);
}

export function templates<Locator>(
  blocks: WireFormat.Core.Blocks,
  compiler: OpcodeBuilderCompiler<Locator>,
  resolver: CompileTimeLookup<Locator>,
  meta: ContainingMetadata<Locator>
): NamedBlocks {
  return NamedBlocksImpl.fromWireFormat(blocks, block => {
    if (!block) return null;

    return inlineBlock(block, compiler, resolver, meta);
  });
}
