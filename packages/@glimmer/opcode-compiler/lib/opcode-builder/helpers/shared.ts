import * as WireFormat from '@glimmer/wire-format';
import { OpcodeBuilderCompiler } from '../interfaces';
import {
  ContainingMetadata,
  Option,
  NamedBlocks,
  CompilableBlock,
  LayoutWithContext,
  CompileTimeLookup,
} from '@glimmer/interfaces';
import { pushYieldableBlock } from './blocks';
import { ExprCompilerState, compileExpression } from '../../syntax';
import { Op } from '@glimmer/vm';
import { EMPTY_ARRAY } from '@glimmer/util';
import { primitive } from './vm';
import { CompilableBlockImpl } from '../../compilable-template';

export function compileArgs<Locator>(
  params: Option<WireFormat.Core.Params>,
  hash: Option<WireFormat.Core.Hash>,
  blocks: NamedBlocks,
  synthetic: boolean,
  state: ExprCompilerState<Locator>
): void {
  let { encoder } = state;

  if (blocks.hasAny) {
    pushYieldableBlock(encoder, blocks.get('default'));
    pushYieldableBlock(encoder, blocks.get('else'));
    pushYieldableBlock(encoder, blocks.get('attrs'));
  }

  let count = compileParams(state, params);

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
      expr(val[i], state);
    }
  }

  encoder.push(Op.PushArgs, { type: 'string-array', value: names }, flags);
}

export function compileParams<Locator>(
  state: ExprCompilerState<Locator>,
  params: Option<WireFormat.Core.Params>
) {
  if (!params) return 0;

  for (let i = 0; i < params.length; i++) {
    expr(params[i], state);
  }

  return params.length;
}

export function params<Locator>(
  params: Option<WireFormat.Core.Params>,
  state: ExprCompilerState<Locator>
) {
  if (!params) return 0;

  for (let i = 0; i < params.length; i++) {
    expr(params[i], state);
  }

  return params.length;
}

export function expr<Locator>(
  expression: WireFormat.Expression,
  state: ExprCompilerState<Locator>
) {
  if (Array.isArray(expression)) {
    compileExpression(expression, state);
  } else {
    primitive(state.encoder, expression);
    state.encoder.push(Op.PrimitiveReference);
  }
}

export function blockForLayout<Locator>(
  layout: LayoutWithContext,
  compiler: OpcodeBuilderCompiler<Locator>,
  resolver: CompileTimeLookup<Locator>
): CompilableBlock {
  let block = {
    statements: layout.block.statements,
    parameters: EMPTY_ARRAY,
  };

  return new CompilableBlockImpl(compiler, resolver, block, meta(layout));
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
