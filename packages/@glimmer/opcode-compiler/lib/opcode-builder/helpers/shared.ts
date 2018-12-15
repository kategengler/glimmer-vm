import * as WireFormat from '@glimmer/wire-format';
import { OpcodeBuilderEncoder, OpcodeBuilderCompiler } from '../interfaces';
import {
  CompileTimeLookup,
  ContainingMetadata,
  Option,
  NamedBlocks,
  CompilableBlock,
  LayoutWithContext,
} from '@glimmer/interfaces';
import { pushYieldableBlock } from './blocks';
import { expressionCompiler } from '../../syntax';
import { Op } from '@glimmer/vm';
import { EMPTY_ARRAY } from '@glimmer/util';
import { primitive } from './vm';
import { CompilableBlockImpl } from '../../compilable-template';

export function compileArgs<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  params: Option<WireFormat.Core.Params>,
  hash: Option<WireFormat.Core.Hash>,
  blocks: NamedBlocks,
  synthetic: boolean
): void {
  if (blocks.hasAny) {
    pushYieldableBlock(encoder, blocks.get('default'), compiler.isEager);
    pushYieldableBlock(encoder, blocks.get('else'), compiler.isEager);
    pushYieldableBlock(encoder, blocks.get('attrs'), compiler.isEager);
  }

  let count = compileParams(encoder, resolver, compiler, meta, params);

  let flags = count << 4;

  if (synthetic) flags |= 0b1000;

  if (blocks) {
    flags |= 0b111;
  }

  let names: string[] = EMPTY_ARRAY;

  if (hash) {
    names = hash[0];
    let val = hash[1];
    for (let i = 0; i < val.length; i++) {
      expr(encoder, resolver, compiler, meta, val[i]);
    }
  }

  encoder.push(Op.PushArgs, { type: 'string-array', value: names }, flags);
}

export function compileParams<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  params: Option<WireFormat.Core.Params>
) {
  if (!params) return 0;

  for (let i = 0; i < params.length; i++) {
    expr(encoder, resolver, compiler, meta, params[i]);
  }

  return params.length;
}

export function params<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  params: Option<WireFormat.Core.Params>
) {
  if (!params) return 0;

  for (let i = 0; i < params.length; i++) {
    expr(encoder, resolver, compiler, meta, params[i]);
  }

  return params.length;
}

export function expr<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  expression: WireFormat.Expression
) {
  if (Array.isArray(expression)) {
    expressionCompiler().compileSimple(expression, encoder, resolver, compiler, meta);
  } else {
    primitive(encoder, expression);
    encoder.push(Op.PrimitiveReference);
  }
}

export function blockFor<Locator>(
  layout: LayoutWithContext,
  compiler: OpcodeBuilderCompiler<Locator>
): CompilableBlock {
  let block = {
    statements: layout.block.statements,
    parameters: EMPTY_ARRAY,
  };

  return new CompilableBlockImpl(compiler, block, meta(layout));
}

export function meta<Locator>(layout: LayoutWithContext<Locator>): ContainingMetadata<Locator> {
  return {
    asPartial: layout.asPartial,
    evalSymbols: evalSymbols(layout),
    referrer: layout.referrer,
    size: layout.block.symbols.length,
  };
}

export function evalSymbols(layout: LayoutWithContext<unknown>): Option<string[]> {
  let { block } = layout;

  return block.hasEval ? block.symbols : null;
}
