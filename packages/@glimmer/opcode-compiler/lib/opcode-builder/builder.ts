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

import { ATTRS_BLOCK, expressionCompiler } from '../syntax';

import { CompilableBlock as CompilableBlockInstance } from '../compilable-template';

import { ComponentBuilderImpl } from '../wrapped-component';
import { InstructionEncoder } from '@glimmer/encoder';
import { NamedBlocksImpl, EMPTY_BLOCKS } from '../utils';
import OpcodeBuilder, {
  Block,
  StringOperand,
  BuilderOperands,
  HandleOperand,
  StaticComponent,
  Component,
  ArrayOperand,
  StringArrayOperand,
  CompileBlock,
  DynamicComponent,
  CurryComponent,
  CompileHelper,
  str,
  Operands,
} from './interfaces';
import { DEBUG } from '@glimmer/local-debug-flags';
import { debugCompiler, AnyAbstractCompiler } from '../compiler';
import { Encoder } from './encoder';
import {
  primitive,
  pushSymbolTable,
  pushYieldableBlock,
  pushCompilable,
  invokePreparedComponent,
  pushPrimitiveReference,
  invokeStatic,
  main,
  resolveCompilable,
  label,
  reserveTarget,
  reserveMachineTarget,
  labels,
  replayable,
  stdAppend,
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

  pushChildScope() {
    this.encoder.push(Op.ChildScope);
  }

  putComponentOperations() {
    this.encoder.push(Op.PutComponentOperations);
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

  private isComponentAttrs = false;

  abstract isEager: boolean;

  constructor(compiler: Compiler, public containingLayout: LayoutWithContext<Locator>) {
    super(compiler, containingLayout ? containingLayout.block.symbols.length : 0);
    this.stdLib = compiler.stdLib;
  }

  get asPartial(): boolean {
    return this.containingLayout.asPartial;
  }

  /// MECHANICS

  get referrer(): Locator {
    return this.containingLayout && this.containingLayout.referrer;
  }

  setComponentAttrs(enabled: boolean): void {
    this.isComponentAttrs = enabled;
  }

  expr(expression: WireFormat.Expression) {
    if (Array.isArray(expression)) {
      expressionCompiler().compile(expression, this);
    } else {
      primitive(this.encoder, expression);
      this.encoder.push(Op.PrimitiveReference);
    }
  }

  push(name: Op, ...args: BuilderOperands): void {
    this.encoder.push(name, ...args);
  }

  pushMachine(name: MachineOp, ...args: Operands): void {
    this.encoder.pushMachine(name, ...args);
  }

  dynamicScope(names: Option<string[]>, block: Block): void {
    this.encoder.push(Op.PushDynamicScope);
    if (names && names.length) {
      this.encoder.push(Op.BindDynamicScope, { type: 'string-array', value: names });
    }
    block(this.encoder);
    this.encoder.push(Op.PopDynamicScope);
  }

  curryComponent({ definition, params, hash, synthetic }: CurryComponent): void {
    let referrer = this.containingLayout.referrer;

    this.encoder.pushMachine(MachineOp.PushFrame);
    this.compileArgs(params, hash, EMPTY_BLOCKS, synthetic);
    this.encoder.push(Op.CaptureArgs);
    this.expr(definition);
    this.encoder.push(Op.CurryComponent, this.constants.serializable(referrer));
    this.encoder.pushMachine(MachineOp.PopFrame);
    this.encoder.push(Op.Fetch, $v0);
  }

  invokeComponent({
    capabilities,
    attrs,
    params,
    hash,
    synthetic,
    blocks: namedBlocks,
    layout,
  }: Component) {
    this.encoder.push(Op.Fetch, $s0);
    this.encoder.push(Op.Dup, $sp, 1);
    this.encoder.push(Op.Load, $s0);

    this.encoder.pushMachine(MachineOp.PushFrame);

    let bindableBlocks = !!namedBlocks;
    let bindableAtNames =
      capabilities === true || capabilities.prepareArgs || !!(hash && hash[0].length !== 0);

    let blocks = namedBlocks.with('attrs', attrs);

    this.compileArgs(params, hash, blocks, synthetic);
    this.encoder.push(Op.PrepareArgs, $s0);

    invokePreparedComponent(
      this.encoder,
      blocks.has('default'),
      bindableBlocks,
      bindableAtNames,
      () => {
        if (layout) {
          pushSymbolTable(this.encoder, layout.symbolTable);
          pushCompilable(this.encoder, layout, this.isEager);
          resolveCompilable(this.encoder, this.isEager);
        } else {
          this.encoder.push(Op.GetComponentLayout, $s0);
        }

        this.encoder.push(Op.PopulateLayout, $s0);
      }
    );

    this.encoder.push(Op.Load, $s0);
  }

  invokeStaticComponent({
    capabilities,
    layout,
    attrs,
    params,
    hash,
    synthetic,
    blocks,
  }: StaticComponent) {
    let { symbolTable } = layout;

    let bailOut = symbolTable.hasEval || capabilities.prepareArgs;

    if (bailOut) {
      this.invokeComponent({ capabilities, attrs, params, hash, synthetic, blocks, layout });
      return;
    }

    this.encoder.push(Op.Fetch, $s0);
    this.encoder.push(Op.Dup, $sp, 1);
    this.encoder.push(Op.Load, $s0);

    let { symbols } = symbolTable;

    if (capabilities.createArgs) {
      this.encoder.pushMachine(MachineOp.PushFrame);
      this.compileArgs(null, hash, EMPTY_BLOCKS, synthetic);
    }

    this.encoder.push(Op.BeginComponentTransaction);

    if (capabilities.dynamicScope) {
      this.encoder.push(Op.PushDynamicScope);
    }

    if (capabilities.createInstance) {
      this.encoder.push(Op.CreateComponent, (blocks.has('default') as any) | 0, $s0);
    }

    if (capabilities.createArgs) {
      this.encoder.pushMachine(MachineOp.PopFrame);
    }

    this.encoder.pushMachine(MachineOp.PushFrame);
    this.encoder.push(Op.RegisterComponentDestructor, $s0);

    let bindings: { symbol: number; isBlock: boolean }[] = [];

    this.encoder.push(Op.GetComponentSelf, $s0);
    bindings.push({ symbol: 0, isBlock: false });

    for (let i = 0; i < symbols.length; i++) {
      let symbol = symbols[i];

      switch (symbol.charAt(0)) {
        case '&':
          let callerBlock;

          if (symbol === ATTRS_BLOCK) {
            callerBlock = attrs;
          } else {
            callerBlock = blocks.get(symbol.slice(1));
          }

          if (callerBlock) {
            pushYieldableBlock(this.encoder, callerBlock, this.isEager);
            bindings.push({ symbol: i + 1, isBlock: true });
          } else {
            pushYieldableBlock(this.encoder, null, this.isEager);
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
            this.expr(values[index]);
            bindings.push({ symbol: i + 1, isBlock: false });
          }

          break;
      }
    }

    this.encoder.push(Op.RootScope, symbols.length + 1, Object.keys(blocks).length > 0 ? 1 : 0);

    for (let i = bindings.length - 1; i >= 0; i--) {
      let { symbol, isBlock } = bindings[i];

      if (isBlock) {
        this.encoder.push(Op.SetBlock, symbol);
      } else {
        this.encoder.push(Op.SetVariable, symbol);
      }
    }

    invokeStatic(this.encoder, layout, this.isEager);

    if (capabilities.createInstance) {
      this.didRenderLayout();
    }

    this.encoder.pushMachine(MachineOp.PopFrame);

    this.encoder.push(Op.PopScope);

    if (capabilities.dynamicScope) {
      this.encoder.push(Op.PopDynamicScope);
    }

    this.encoder.push(Op.CommitComponentTransaction);
    this.encoder.push(Op.Load, $s0);
  }

  invokeDynamicComponent({ definition, attrs, params, hash, synthetic, blocks }: DynamicComponent) {
    replayable(this.encoder, {
      args: () => {
        this.expr(definition);
        this.encoder.push(Op.Dup, $sp, 0);
        return 2;
      },

      body: () => {
        this.jumpUnless('ELSE');

        this.resolveDynamicComponent(this.containingLayout.referrer);

        this.encoder.push(Op.PushDynamicComponentInstance);

        this.invokeComponent({ capabilities: true, attrs, params, hash, synthetic, blocks });

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

    this.expr(expression);

    this.encoder.pushMachine(MachineOp.InvokeStatic, this.stdLib.getAppend(trusting));

    this.encoder.pushMachine(MachineOp.PopFrame);
  }

  invokeStaticBlock(block: CompilableBlock, callerCount = 0): void {
    let { parameters } = block.symbolTable;
    let calleeCount = parameters.length;
    let count = Math.min(callerCount, calleeCount);

    this.encoder.pushMachine(MachineOp.PushFrame);

    if (count) {
      this.pushChildScope();

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
      this.setComponentAttrs(true);
      this.putComponentOperations();
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
        this.invokeStaticComponent({
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
        this.invokeComponent({
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
        this.invokeStaticComponent({
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

  // debugger

  debugger(symbols: string[], evalInfo: number[]) {
    this.encoder.push(
      Op.Debugger,
      this.constants.stringArray(symbols),
      this.constants.array(evalInfo)
    );
  }

  // dom

  protected text(text: string) {
    this.encoder.push(Op.Text, this.constants.string(text));
  }

  protected openPrimitiveElement(tag: string) {
    this.encoder.push(Op.OpenElement, this.constants.string(tag));
  }

  modifier({ handle, params, hash }: CompileHelper) {
    this.encoder.pushMachine(MachineOp.PushFrame);
    this.compileArgs(params, hash, EMPTY_BLOCKS, true);
    this.encoder.push(Op.Modifier, this.constants.handle(handle));
    this.encoder.pushMachine(MachineOp.PopFrame);
  }

  protected comment(_comment: string) {
    let comment = this.constants.string(_comment);
    this.encoder.push(Op.Comment, comment);
  }

  dynamicAttr(_name: string, _namespace: Option<string>, trusting: boolean) {
    let name = this.constants.string(_name);
    let namespace = _namespace ? this.constants.string(_namespace) : 0;

    if (this.isComponentAttrs) {
      this.encoder.push(Op.ComponentAttr, name, trusting === true ? 1 : 0, namespace);
    } else {
      this.encoder.push(Op.DynamicAttr, name, trusting === true ? 1 : 0, namespace);
    }
  }

  staticAttr(_name: string, _namespace: Option<string>, _value: string): void {
    let name = this.constants.string(_name);
    let namespace = _namespace ? this.constants.string(_namespace) : 0;

    if (this.isComponentAttrs) {
      pushPrimitiveReference(this.encoder, _value);
      this.encoder.push(Op.ComponentAttr, name, 1, namespace);
    } else {
      let value = this.constants.string(_value);
      this.encoder.push(Op.StaticAttr, name, value, namespace);
    }
  }

  // expressions

  hasBlockParams(to: number) {
    this.encoder.push(Op.GetBlock, to);
    resolveCompilable(this.encoder, this.isEager);
    this.encoder.push(Op.HasBlockParams);
  }

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
      this.expr(params[i]);
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
        this.expr(val[i]);
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
