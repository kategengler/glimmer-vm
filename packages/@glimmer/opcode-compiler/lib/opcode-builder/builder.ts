import {
  Opaque,
  Option,
  Recast,
  CompilableBlock,
  CompileTimeConstants,
  CompileTimeLazyConstants,
  STDLib,
  Compiler,
  LayoutWithContext,
  NamedBlocks,
} from '@glimmer/interfaces';
import { EMPTY_ARRAY } from '@glimmer/util';
import {
  Op,
  $sp,
  $fp,
  $s0,
  $v0,
  MachineRegister,
  MachineOp,
  SavedRegister,
  $s1,
} from '@glimmer/vm';
import * as WireFormat from '@glimmer/wire-format';
import { SerializedInlineBlock, Expression } from '@glimmer/wire-format';

import { ComponentArgs } from '../interfaces';

import { CompilableBlock as CompilableBlockInstance } from '../compilable-template';

import { ComponentBuilderImpl } from '../wrapped-component';
import { InstructionEncoder } from '@glimmer/encoder';
import { NamedBlocksImpl, EMPTY_BLOCKS } from '../utils';
import OpcodeBuilder, {
  Block,
  StringOperand,
  BuilderOperands,
  HandleOperand,
  ArrayOperand,
  StringArrayOperand,
  CompileBlock,
  DynamicComponent,
  CompileHelper,
  str,
  Operands,
  ContainingMetadata,
} from './interfaces';
import { DEBUG } from '@glimmer/local-debug-flags';
import { debugCompiler, AnyAbstractCompiler } from '../compiler';
import { Encoder } from './encoder';
import {
  pushYieldableBlock,
  pushCompilable,
  main,
  resolveCompilable,
  label,
  reserveTarget,
  reserveMachineTarget,
  labels,
  replayable,
  stdAppend,
  expr,
  invokeComponent,
  invokeStaticComponent,
} from './helpers';

export const constant = {
  string(value: string): StringOperand {
    return { type: 'string', value };
  },

  array(value: number[]): ArrayOperand {
    return { type: 'array', value };
  },

  stringArray(value: string[]): StringArrayOperand {
    return { type: 'string-array', value };
  },

  handle(value: number): HandleOperand {
    return { type: 'handle', value };
  },
};

class StdLib {
  constructor(
    public main: number,
    private trustingGuardedAppend: number,
    private cautiousGuardedAppend: number
  ) {}

  getAppend(trusting: boolean) {
    return trusting ? this.trustingGuardedAppend : this.cautiousGuardedAppend;
  }
}

export class StdOpcodeBuilder {
  static compileStd(compiler: Compiler): StdLib {
    let mainHandle = StdOpcodeBuilder.build(compiler, b => main(b.encoder));
    let trustingGuardedAppend = StdOpcodeBuilder.build(compiler, b => stdAppend(b.encoder, true));
    let cautiousGuardedAppend = StdOpcodeBuilder.build(compiler, b => stdAppend(b.encoder, false));
    return new StdLib(mainHandle, trustingGuardedAppend, cautiousGuardedAppend);
  }

  static build(compiler: Compiler, callback: (builder: StdOpcodeBuilder) => void): number {
    let builder = new StdOpcodeBuilder(compiler);
    callback(builder);
    return builder.commit();
  }

  readonly constants: CompileTimeConstants;
  readonly encoder: Encoder;
  protected instructionEncoder = new InstructionEncoder([]);

  public compiler: Compiler<this>;

  constructor(compiler: Compiler, protected size = 0) {
    this.compiler = compiler as Compiler<this>;
    this.constants = compiler.constants;
    this.encoder = new Encoder(this.instructionEncoder, this.constants);
  }

  commit(): number {
    this.encoder.pushMachine(MachineOp.Return);
    return this.compiler.commit(this.size, this.instructionEncoder.buffer);
  }

  ///

  remoteElement(block: Block): void {
    this.encoder.push(Op.PushRemoteElement);
    block(this.encoder);
    this.encoder.push(Op.PopRemoteElement);
  }

  didRenderLayout() {
    this.encoder.push(Op.DidRenderLayout, $s0);
  }

  frame(block: Block): void {
    this.encoder.pushMachine(MachineOp.PushFrame);
    block(this.encoder);
    this.encoder.pushMachine(MachineOp.PopFrame);
  }

  toBoolean() {
    this.encoder.push(Op.ToBoolean);
  }

  ///

  compileInline(sexp: WireFormat.Statements.Append): ['expr', Expression] | true {
    return this.compiler.compileInline(sexp, this);
  }

  compileBlock({ name, params, hash, blocks }: CompileBlock): void {
    this.compiler.compileBlock(name, params, hash, blocks, this);
  }

  // helpers

  // lists

  list(start: string, block: Block): void {
    reserveTarget(this.encoder, Op.EnterList, start);
    block(this.encoder);
    this.encoder.push(Op.ExitList);
  }

  iterate(breaks: string) {
    reserveTarget(this.encoder, Op.Iterate, breaks);
  }

  // expressions

  withSavedRegister(register: SavedRegister, block: Block): void {
    this.encoder.push(Op.Fetch, register);
    block(this.encoder);
    this.encoder.push(Op.Load, register);
  }

  dup(register: MachineRegister = $sp, offset = 0) {
    return this.encoder.push(Op.Dup, register, offset);
  }

  pop(count = 1) {
    return this.encoder.push(Op.Pop, count);
  }

  // vm

  jump(target: string) {
    reserveMachineTarget(this.encoder, MachineOp.Jump, target);
  }

  jumpUnless(target: string) {
    reserveTarget(this.encoder, Op.JumpUnless, target);
  }
}

export abstract class OpcodeBuilderImpl<Locator = Opaque> extends StdOpcodeBuilder
  implements OpcodeBuilder<Locator> {
  public stdLib: STDLib;
  public component: ComponentBuilderImpl<Locator> = new ComponentBuilderImpl(this);
  readonly meta: ContainingMetadata<Locator>;

  abstract isEager: boolean;

  constructor(
    readonly resolver: Compiler,
    public containingLayout: LayoutWithContext<Locator>,
    isEager: boolean
  ) {
    super(resolver, containingLayout ? containingLayout.block.symbols.length : 0);

    this.meta = {
      asPartial: containingLayout.asPartial,
      isEager,
      evalSymbols: evalSymbols(containingLayout),
      referrer: containingLayout.referrer,
    };

    this.stdLib = resolver.stdLib;
  }

  get asPartial(): boolean {
    return this.containingLayout.asPartial;
  }

  /// MECHANICS

  get referrer(): Locator {
    return this.containingLayout && this.containingLayout.referrer;
  }

  setComponentAttrs(enabled: boolean): void {
    this.encoder.isComponentAttrs = enabled;
  }

  push(name: Op, ...args: BuilderOperands): void {
    this.encoder.push(name, ...args);
  }

  pushMachine(name: MachineOp, ...args: Operands): void {
    this.encoder.pushMachine(name, ...args);
  }

  invokeDynamicComponent({ definition, attrs, params, hash, synthetic, blocks }: DynamicComponent) {
    replayable(this.encoder, {
      args: () => {
        expr(this.encoder, this.resolver, this.meta, definition);
        this.encoder.push(Op.Dup, $sp, 0);
        return 2;
      },

      body: () => {
        this.jumpUnless('ELSE');

        this.resolveDynamicComponent(this.containingLayout.referrer);

        this.encoder.push(Op.PushDynamicComponentInstance);

        invokeComponent(this.encoder, this.resolver, this.meta, {
          capabilities: true,
          attrs,
          params,
          hash,
          synthetic,
          blocks,
        });

        label(this.encoder, 'ELSE');
      },
    });
  }

  yield(to: number, params: Option<WireFormat.Core.Params>) {
    this.compileArgs(params, null, EMPTY_BLOCKS, false);
    this.encoder.push(Op.GetBlock, to);
    resolveCompilable(this.encoder, this.isEager);
    this.encoder.push(Op.InvokeYield);
    this.encoder.push(Op.PopScope);
    this.encoder.pushMachine(MachineOp.PopFrame);
  }

  guardedAppend(expression: WireFormat.Expression, trusting: boolean): void {
    this.encoder.pushMachine(MachineOp.PushFrame);

    expr(this.encoder, this.resolver, this.meta, expression);

    this.encoder.pushMachine(MachineOp.InvokeStatic, this.stdLib.getAppend(trusting));

    this.encoder.pushMachine(MachineOp.PopFrame);
  }

  invokeStaticBlock(block: CompilableBlock, callerCount = 0): void {
    let { parameters } = block.symbolTable;
    let calleeCount = parameters.length;
    let count = Math.min(callerCount, calleeCount);

    this.encoder.pushMachine(MachineOp.PushFrame);

    if (count) {
      this.encoder.push(Op.ChildScope);

      for (let i = 0; i < count; i++) {
        this.encoder.push(Op.Dup, $fp, callerCount - i);
        this.encoder.push(Op.SetVariable, parameters[i]);
      }
    }

    pushCompilable(this.encoder, block, this.isEager);
    resolveCompilable(this.encoder, this.isEager);
    this.encoder.pushMachine(MachineOp.InvokeVirtual);

    if (count) {
      this.encoder.push(Op.PopScope);
    }

    this.encoder.pushMachine(MachineOp.PopFrame);
  }

  /// CONVENIENCE

  wrappedComponent(layout: LayoutWithContext<Locator>, attrsBlockNumber: number) {
    labels(this.encoder, () => {
      this.withSavedRegister($s1, () => {
        this.encoder.push(Op.GetComponentTagName, $s0);
        this.encoder.push(Op.PrimitiveReference);

        this.encoder.push(Op.Dup, $sp, 0);
      });

      this.jumpUnless('BODY');

      this.encoder.push(Op.Fetch, $s1);
      this.encoder.isComponentAttrs = true;
      this.encoder.push(Op.PutComponentOperations);
      this.encoder.push(Op.OpenDynamicElement);
      this.encoder.push(Op.DidCreateElement, $s0);
      this.yield(attrsBlockNumber, []);
      this.setComponentAttrs(false);
      this.encoder.push(Op.FlushElement);

      label(this.encoder, 'BODY');

      this.invokeStaticBlock(blockFor(layout, this.compiler));

      this.encoder.push(Op.Fetch, $s1);
      this.jumpUnless('END');
      this.encoder.push(Op.CloseElement);

      label(this.encoder, 'END');
      this.encoder.push(Op.Load, $s1);
    });

    let handle = this.commit();

    if (DEBUG) {
      debugCompiler(this.compiler as Recast<any, AnyAbstractCompiler>, handle);
    }

    return handle;
  }

  staticComponent(handle: number, args: ComponentArgs): void {
    let [params, hash, blocks] = args;

    if (handle !== null) {
      let { capabilities, compilable } = this.compiler.resolveLayoutForHandle(handle);

      if (compilable) {
        this.pushComponentDefinition(handle);
        invokeStaticComponent(this.encoder, this.resolver, this.meta, {
          capabilities,
          layout: compilable,
          attrs: null,
          params,
          hash,
          synthetic: false,
          blocks,
        });
      } else {
        this.pushComponentDefinition(handle);
        invokeComponent(this.encoder, this.resolver, this.meta, {
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

  // components

  protected pushComponentDefinition(handle: number) {
    this.encoder.push(Op.PushComponentDefinition, this.constants.handle(handle));
  }

  protected resolveDynamicComponent(referrer: Locator) {
    this.encoder.push(Op.ResolveDynamicComponent, this.constants.serializable(referrer));
  }

  staticComponentHelper(
    tag: string,
    hash: WireFormat.Core.Hash,
    template: Option<CompilableBlock>
  ): boolean {
    let { handle, capabilities, compilable } = this.compiler.resolveLayoutForTag(
      tag,
      this.referrer
    );

    if (handle !== null && capabilities !== null) {
      if (compilable) {
        if (hash) {
          for (let i = 0; i < hash.length; i = i + 2) {
            hash[i][0] = `@${hash[i][0]}`;
          }
        }

        this.pushComponentDefinition(handle);
        invokeStaticComponent(this.encoder, this.resolver, this.meta, {
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

  // partial

  invokePartial(referrer: Locator, symbols: string[], evalInfo: number[]) {
    let _meta = this.constants.serializable(referrer);
    let _symbols = this.constants.stringArray(symbols);
    let _evalInfo = this.constants.array(evalInfo);

    this.encoder.push(Op.InvokePartial, _meta, _symbols, _evalInfo);
  }

  protected resolveMaybeLocal(name: string) {
    this.encoder.push(Op.ResolveMaybeLocal, str(name));
  }

  // dom

  protected text(text: string) {
    this.encoder.push(Op.Text, this.constants.string(text));
  }

  protected openPrimitiveElement(tag: string) {
    this.encoder.push(Op.OpenElement, this.constants.string(tag));
  }

  protected comment(_comment: string) {
    let comment = this.constants.string(_comment);
    this.encoder.push(Op.Comment, comment);
  }

  dynamicAttr(_name: string, _namespace: Option<string>, trusting: boolean) {
    let name = this.constants.string(_name);
    let namespace = _namespace ? this.constants.string(_namespace) : 0;

    if (this.encoder.isComponentAttrs) {
      this.encoder.push(Op.ComponentAttr, name, trusting === true ? 1 : 0, namespace);
    } else {
      this.encoder.push(Op.DynamicAttr, name, trusting === true ? 1 : 0, namespace);
    }
  }

  // expressions

  protected getProperty(key: string) {
    this.encoder.push(Op.GetProperty, str(key));
  }

  helper({ handle, params, hash }: CompileHelper) {
    this.encoder.pushMachine(MachineOp.PushFrame);
    this.compileArgs(params, hash, EMPTY_BLOCKS, true);
    this.encoder.push(Op.Helper, this.constants.handle(handle));
    this.encoder.pushMachine(MachineOp.PopFrame);
    this.encoder.push(Op.Fetch, $v0);
  }

  bindDynamicScope(_names: string[]) {
    this.encoder.push(Op.BindDynamicScope, { type: 'string-array', value: _names });
  }

  // convenience methods

  inlineBlock(block: SerializedInlineBlock): CompilableBlock {
    return new CompilableBlockInstance(this.compiler, {
      block,
      containingLayout: this.containingLayout,
    });
  }

  get evalSymbols(): Option<string[]> {
    let {
      containingLayout: { block },
    } = this;

    return block.hasEval ? block.symbols : null;
  }

  params(params: Option<WireFormat.Core.Params>) {
    if (!params) return 0;

    for (let i = 0; i < params.length; i++) {
      expr(this.encoder, this.resolver, this.meta, params[i]);
    }

    return params.length;
  }

  protected compileArgs(
    params: Option<WireFormat.Core.Params>,
    hash: Option<WireFormat.Core.Hash>,
    blocks: NamedBlocks,
    synthetic: boolean
  ): void {
    if (blocks.hasAny) {
      pushYieldableBlock(this.encoder, blocks.get('default'), this.isEager);
      pushYieldableBlock(this.encoder, blocks.get('else'), this.isEager);
      pushYieldableBlock(this.encoder, blocks.get('attrs'), this.isEager);
    }

    let count = this.params(params);

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
        expr(this.encoder, this.resolver, this.meta, val[i]);
      }
    }

    this.encoder.push(Op.PushArgs, { type: 'string-array', value: names }, flags);
  }

  templates(blocks: WireFormat.Core.Blocks): NamedBlocks {
    return NamedBlocksImpl.fromWireFormat(blocks, block => {
      if (!block) return null;

      return this.inlineBlock(block);
    });
  }
}

export default OpcodeBuilderImpl;

export class LazyOpcodeBuilder<Locator> extends OpcodeBuilderImpl<Locator> {
  public constants!: CompileTimeLazyConstants; // Hides property on base class

  readonly isEager = false;
}

export class EagerOpcodeBuilder<Locator> extends OpcodeBuilderImpl<Locator> {
  readonly isEager = true;
}

function blockFor<Locator>(
  layout: LayoutWithContext,
  compiler: Compiler<OpcodeBuilder<Locator>>
): CompilableBlock {
  return new CompilableBlockInstance(compiler, {
    block: {
      statements: layout.block.statements,
      parameters: EMPTY_ARRAY,
    },
    containingLayout: layout,
  });
}

function evalSymbols(layout: LayoutWithContext<unknown>): Option<string[]> {
  let { block } = layout;

  return block.hasEval ? block.symbols : null;
}
