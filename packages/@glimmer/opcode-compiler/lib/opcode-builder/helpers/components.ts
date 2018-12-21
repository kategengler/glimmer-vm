import {
  CompileTimeLookup,
  ContainingMetadata,
  Option,
  CompilableBlock,
  LayoutWithContext,
  WireFormat,
  Op,
  MachineOp,
} from '@glimmer/interfaces';

import {
  OpcodeBuilderEncoder,
  OpcodeBuilderCompiler,
  StaticComponent,
  DynamicComponent,
  Component,
  CurryComponent,
  label,
} from '../interfaces';
import { resolveLayoutForTag, resolveLayoutForHandle } from '../../resolver';
import { $s0, $sp, $s1, $v0 } from '@glimmer/vm';
import { NamedBlocksImpl, EMPTY_BLOCKS } from '../../utils';
import { compileArgs, expr, blockForLayout } from './shared';
import {
  pushYieldableBlock,
  yieldBlock,
  pushSymbolTable,
  pushCompilable,
  invokeStatic,
  invokeStaticBlock,
} from './blocks';
import { ATTRS_BLOCK, ExprCompilerState } from '../../syntax';
import { labels } from './labels';
import { DEBUG } from '@glimmer/local-debug-flags';
import { debugCompiler } from '../../compiler';
import { ComponentArgs } from '../../interfaces';
import { replayable } from './conditional';
import { withSavedRegister } from './vm';
import { EMPTY_ARRAY } from '@glimmer/util';

export function staticComponentHelper<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  tag: string,
  hash: WireFormat.Core.Hash,
  template: Option<CompilableBlock>
): boolean {
  let { handle, capabilities, compilable } = resolveLayoutForTag(tag, resolver, meta.referrer);

  if (handle !== null && capabilities !== null) {
    if (compilable) {
      if (hash) {
        for (let i = 0; i < hash.length; i = i + 2) {
          hash[i][0] = `@${hash[i][0]}`;
        }
      }

      encoder.push(Op.PushComponentDefinition, { type: 'handle', value: handle });
      invokeStaticComponent(encoder, resolver, compiler, meta, {
        capabilities,
        layout: compilable,
        attrs: null,
        params: null,
        hash,
        synthetic: false,
        blocks: NamedBlocksImpl.from('default', template),
      });

      return true;
    }
  }

  return false;
}

export function invokeStaticComponent<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  { capabilities, layout, attrs, params, hash, synthetic, blocks }: StaticComponent
) {
  let { symbolTable } = layout;

  let bailOut = symbolTable.hasEval || capabilities.prepareArgs;

  if (bailOut) {
    invokeComponent(encoder, resolver, compiler, meta, {
      capabilities,
      attrs,
      params,
      hash,
      synthetic,
      blocks,
      layout,
    });
    return;
  }

  encoder.push(Op.Fetch, $s0);
  encoder.push(Op.Dup, $sp, 1);
  encoder.push(Op.Load, $s0);

  let { symbols } = symbolTable;
  let state = { encoder, resolver, meta };

  if (capabilities.createArgs) {
    encoder.push(MachineOp.PushFrame);
    compileArgs(null, hash, EMPTY_BLOCKS, synthetic, { encoder, resolver, meta });
  }

  encoder.push(Op.BeginComponentTransaction);

  if (capabilities.dynamicScope) {
    encoder.push(Op.PushDynamicScope);
  }

  if (capabilities.createInstance) {
    encoder.push(Op.CreateComponent, (blocks.has('default') as any) | 0, $s0);
  }

  if (capabilities.createArgs) {
    encoder.push(MachineOp.PopFrame);
  }

  encoder.push(MachineOp.PushFrame);
  encoder.push(Op.RegisterComponentDestructor, $s0);

  let bindings: { symbol: number; isBlock: boolean }[] = [];

  encoder.push(Op.GetComponentSelf, $s0);
  bindings.push({ symbol: 0, isBlock: false });

  for (let i = 0; i < symbols.length; i++) {
    let symbol = symbols[i];

    switch (symbol.charAt(0)) {
      case '&':
        let callerBlock: Option<CompilableBlock>;

        if (symbol === ATTRS_BLOCK) {
          callerBlock = attrs;
        } else {
          callerBlock = blocks.get(symbol.slice(1));
        }

        if (callerBlock) {
          pushYieldableBlock(encoder, callerBlock);
          bindings.push({ symbol: i + 1, isBlock: true });
        } else {
          pushYieldableBlock(encoder, null);
          bindings.push({ symbol: i + 1, isBlock: true });
        }

        break;

      case '@':
        if (!hash) {
          break;
        }

        let [keys, values] = hash;
        let lookupName = symbol;

        if (synthetic) {
          lookupName = symbol.slice(1);
        }

        let index = keys.indexOf(lookupName);

        if (index !== -1) {
          expr(values[index], state);
          bindings.push({ symbol: i + 1, isBlock: false });
        }

        break;
    }
  }

  encoder.push(Op.RootScope, symbols.length + 1, Object.keys(blocks).length > 0 ? 1 : 0);

  for (let i = bindings.length - 1; i >= 0; i--) {
    let { symbol, isBlock } = bindings[i];

    if (isBlock) {
      encoder.push(Op.SetBlock, symbol);
    } else {
      encoder.push(Op.SetVariable, symbol);
    }
  }

  invokeStatic(encoder, layout, compiler.isEager);

  if (capabilities.createInstance) {
    encoder.push(Op.DidRenderLayout, $s0);
  }

  encoder.push(MachineOp.PopFrame);
  encoder.push(Op.PopScope);

  if (capabilities.dynamicScope) {
    encoder.push(Op.PopDynamicScope);
  }

  encoder.push(Op.CommitComponentTransaction);
  encoder.push(Op.Load, $s0);
}

export function invokeDynamicComponent<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  { definition, attrs, params, hash, synthetic, blocks }: DynamicComponent
) {
  let state = { encoder, resolver, meta };

  replayable(encoder, {
    args: () => {
      expr(definition, state);
      encoder.push(Op.Dup, $sp, 0);
      return 2;
    },

    body: () => {
      encoder.push(Op.JumpUnless, label('ELSE'));

      encoder.push(Op.ResolveDynamicComponent, { type: 'serializable', value: meta.referrer });
      encoder.push(Op.PushDynamicComponentInstance);

      invokeComponent(encoder, resolver, compiler, meta, {
        capabilities: true,
        attrs,
        params,
        hash,
        synthetic,
        blocks,
      });

      encoder.label('ELSE');
    },
  });
}

export function wrappedComponent<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  layout: LayoutWithContext<Locator>,
  attrsBlockNumber: number
) {
  labels(encoder, () => {
    withSavedRegister(encoder, $s1, () => {
      encoder.push(Op.GetComponentTagName, $s0);
      encoder.push(Op.PrimitiveReference);

      encoder.push(Op.Dup, $sp, 0);
    });

    encoder.push(Op.JumpUnless, label('BODY'));

    encoder.push(Op.Fetch, $s1);
    // encoder.isComponentAttrs = true;
    encoder.push(Op.PutComponentOperations);
    encoder.push(Op.OpenDynamicElement);
    encoder.push(Op.DidCreateElement, $s0);
    encoder.concat(yieldBlock(attrsBlockNumber, EMPTY_ARRAY, encoder.isEager));
    // encoder.isComponentAttrs = false;
    encoder.push(Op.FlushElement);

    encoder.label('BODY');

    invokeStaticBlock(encoder, compiler, blockForLayout(layout, compiler, resolver));

    encoder.push(Op.Fetch, $s1);
    encoder.push(Op.JumpUnless, label('END'));
    encoder.push(Op.CloseElement);

    encoder.label('END');
    encoder.push(Op.Load, $s1);
  });

  let handle = encoder.commit(compiler.heap);

  if (DEBUG) {
    debugCompiler(compiler, handle);
  }

  return handle;
}

export function staticComponent<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  handle: number,
  args: ComponentArgs
): void {
  let [params, hash, blocks] = args;

  if (handle !== null) {
    let { capabilities, compilable } = resolveLayoutForHandle(resolver, handle);

    if (compilable) {
      encoder.push(Op.PushComponentDefinition, { type: 'handle', value: handle });

      invokeStaticComponent(encoder, resolver, compiler, meta, {
        capabilities,
        layout: compilable,
        attrs: null,
        params,
        hash,
        synthetic: false,
        blocks,
      });
    } else {
      encoder.push(Op.PushComponentDefinition, { type: 'handle', value: handle });

      invokeComponent(encoder, resolver, compiler, meta, {
        capabilities,
        attrs: null,
        params,
        hash,
        synthetic: false,
        blocks,
      });
    }
  }
}

export function invokeComponent<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  { capabilities, attrs, params, hash, synthetic, blocks: namedBlocks, layout }: Component
) {
  encoder.push(Op.Fetch, $s0);
  encoder.push(Op.Dup, $sp, 1);
  encoder.push(Op.Load, $s0);

  encoder.push(MachineOp.PushFrame);

  let bindableBlocks = !!namedBlocks;
  let bindableAtNames =
    capabilities === true || capabilities.prepareArgs || !!(hash && hash[0].length !== 0);

  let blocks = namedBlocks.with('attrs', attrs);
  let state = { encoder, resolver, meta };

  compileArgs(params, hash, blocks, synthetic, state);
  encoder.push(Op.PrepareArgs, $s0);

  invokePreparedComponent(encoder, blocks.has('default'), bindableBlocks, bindableAtNames, () => {
    if (layout) {
      pushSymbolTable(encoder, layout.symbolTable);
      pushCompilable(encoder, layout, compiler.isEager);
      if (!compiler.isEager) encoder.push(Op.CompileBlock);
    } else {
      encoder.push(Op.GetComponentLayout, $s0);
    }

    encoder.push(Op.PopulateLayout, $s0);
  });

  encoder.push(Op.Load, $s0);
}

export function invokePreparedComponent(
  encoder: OpcodeBuilderEncoder,
  hasBlock: boolean,
  bindableBlocks: boolean,
  bindableAtNames: boolean,
  populateLayout: Option<(encoder: OpcodeBuilderEncoder) => void> = null
) {
  encoder.push(Op.BeginComponentTransaction);
  encoder.push(Op.PushDynamicScope);

  encoder.push(Op.CreateComponent, (hasBlock as any) | 0, $s0);

  // this has to run after createComponent to allow
  // for late-bound layouts, but a caller is free
  // to populate the layout earlier if it wants to
  // and do nothing here.
  if (populateLayout) populateLayout(encoder);

  encoder.push(Op.RegisterComponentDestructor, $s0);
  encoder.push(Op.GetComponentSelf, $s0);

  encoder.push(Op.VirtualRootScope, $s0);
  encoder.push(Op.SetVariable, 0);

  encoder.push(Op.SetupForEval, $s0);
  if (bindableAtNames) encoder.push(Op.SetNamedVariables, $s0);
  if (bindableBlocks) encoder.push(Op.SetBlocks, $s0);
  encoder.push(Op.Pop, 1);
  encoder.push(Op.InvokeComponentLayout, $s0);
  encoder.push(Op.DidRenderLayout, $s0);
  encoder.push(MachineOp.PopFrame);

  encoder.push(Op.PopScope);
  encoder.push(Op.PopDynamicScope);
  encoder.push(Op.CommitComponentTransaction);
}

export function invokeBareComponent(encoder: OpcodeBuilderEncoder) {
  encoder.push(Op.Fetch, $s0);
  encoder.push(Op.Dup, $sp, 1);
  encoder.push(Op.Load, $s0);

  encoder.push(MachineOp.PushFrame);
  encoder.push(Op.PushEmptyArgs);
  encoder.push(Op.PrepareArgs, $s0);

  invokePreparedComponent(encoder, false, false, true, () => {
    encoder.push(Op.GetComponentLayout, $s0);
    encoder.push(Op.PopulateLayout, $s0);
  });

  encoder.push(Op.Load, $s0);
}

export function curryComponent<Locator>(
  state: ExprCompilerState<Locator>,
  { definition, params, hash, synthetic }: CurryComponent
): void {
  let { encoder, meta } = state;
  let referrer = meta.referrer;

  encoder.push(MachineOp.PushFrame);
  compileArgs(params, hash, EMPTY_BLOCKS, synthetic, state);
  encoder.push(Op.CaptureArgs);
  expr(definition, state);
  encoder.push(Op.CurryComponent, { type: 'serializable', value: referrer });
  encoder.push(MachineOp.PopFrame);
  encoder.push(Op.Fetch, $v0);
}
