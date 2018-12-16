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
  params: Option<WireFormat.Core.Params>,
  hash: Option<WireFormat.Core.Hash>,
  blocks: NamedBlocks,
  synthetic: boolean,
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  meta: ContainingMetadata<Locator>,
  isEager: boolean
): void {
  if (blocks.hasAny) {
    pushYieldableBlock(encoder, blocks.get('default'), isEager);
    pushYieldableBlock(encoder, blocks.get('else'), isEager);
    pushYieldableBlock(encoder, blocks.get('attrs'), isEager);
  }

  let count = compileParams(encoder, resolver, meta, isEager, params);

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
      expr(val[i], encoder, resolver, meta, isEager);
    }
  }

  encoder.push(Op.PushArgs, { type: 'string-array', value: names }, flags);
}

export function compileParams<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  meta: ContainingMetadata<Locator>,
  isEager: boolean,
  params: Option<WireFormat.Core.Params>
) {
  if (!params) return 0;

  for (let i = 0; i < params.length; i++) {
    expr(params[i], encoder, resolver, meta, isEager);
  }

  return params.length;
}

export function params<Locator>(
  params: Option<WireFormat.Core.Params>,
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  meta: ContainingMetadata<Locator>,
  isEager: boolean
) {
  if (!params) return 0;

  for (let i = 0; i < params.length; i++) {
    expr(params[i], encoder, resolver, meta, isEager);
  }

  return params.length;
}

export function expr<Locator>(
  // state: OpcodeBuilderState<Locator>,
  expression: WireFormat.Expression,
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  meta: ContainingMetadata<Locator>,
  isEager: boolean
) {
  if (Array.isArray(expression)) {
    expressionCompiler().compile(expression, encoder, resolver, meta, isEager);
  } else {
    primitive(encoder, expression);
    encoder.push(Op.PrimitiveReference);
  }
}

export function blockForLayout<Locator>(
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
