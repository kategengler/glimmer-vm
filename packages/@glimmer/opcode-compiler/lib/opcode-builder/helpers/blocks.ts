import {
  CompileTimeLookup,
  ContainingMetadata,
  Option,
  CompilableBlock,
  SymbolTable,
  CompilableTemplate,
} from '@glimmer/interfaces';
import * as WireFormat from '@glimmer/wire-format';
import { Op, MachineOp, $fp } from '@glimmer/vm';
import { EMPTY_BLOCKS } from '@glimmer/opcode-compiler';

import { OpcodeBuilderEncoder, OpcodeBuilderCompiler } from '../interfaces';
import { compileArgs } from './shared';
import { primitive } from './vm';

export function yieldBlock<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  to: number,
  params: Option<WireFormat.Core.Params>
) {
  compileArgs(encoder, resolver, compiler, meta, params, null, EMPTY_BLOCKS, false);
  encoder.push(Op.GetBlock, to);
  resolveCompilable(encoder, compiler.isEager);
  encoder.push(Op.InvokeYield);
  encoder.push(Op.PopScope);
  encoder.pushMachine(MachineOp.PopFrame);
}

export function pushYieldableBlock(
  encoder: OpcodeBuilderEncoder,
  block: Option<CompilableBlock>,
  isEager: boolean
) {
  pushSymbolTable(encoder, block && block.symbolTable);
  encoder.push(Op.PushBlockScope);

  if (block === null) {
    primitive(encoder, null);
  } else if (isEager) {
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
  block: CompilableBlock,
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

  pushCompilable(encoder, block, compiler.isEager);
  resolveCompilable(encoder, compiler.isEager);
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

export function resolveCompilable(encoder: OpcodeBuilderEncoder, isEager: boolean) {
  if (!isEager) {
    encoder.push(Op.CompileBlock);
  }
}
