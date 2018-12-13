import {
  Option,
  Recast,
  CompilableBlock,
  CompileTimeConstants,
  CompileTimeLazyConstants,
  STDLib,
  Compiler,
  LayoutWithContext,
  NamedBlocks,
  ContainingMetadata,
} from '@glimmer/interfaces';
import { EMPTY_ARRAY } from '@glimmer/util';
import { Op, $sp, $s0, $v0, MachineRegister, MachineOp, SavedRegister, $s1 } from '@glimmer/vm';
import * as WireFormat from '@glimmer/wire-format';
import { SerializedInlineBlock, Expression } from '@glimmer/wire-format';

import { ComponentArgs, ComponentBuilder } from '../interfaces';

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
  CompileHelper,
  str,
  Operands,
} from './interfaces';
import { DEBUG } from '@glimmer/local-debug-flags';
import { debugCompiler, AnyAbstractCompiler } from '../compiler';
import { Encoder } from './encoder';
import {
  main,
  label,
  reserveTarget,
  reserveMachineTarget,
  labels,
  stdAppend,
  invokeComponent,
  invokeStaticComponent,
  compileArgs,
  yieldBlock,
  invokeStaticBlock,
  meta,
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

export class StdOpcodeBuilder<Locator> {
  static compileStd(compiler: Compiler): StdLib {
    let mainHandle = StdOpcodeBuilder.build(compiler, b => main(b.encoder));
    let trustingGuardedAppend = StdOpcodeBuilder.build(compiler, b => stdAppend(b.encoder, true));
    let cautiousGuardedAppend = StdOpcodeBuilder.build(compiler, b => stdAppend(b.encoder, false));
    return new StdLib(mainHandle, trustingGuardedAppend, cautiousGuardedAppend);
  }

  static build(compiler: Compiler, callback: (builder: StdOpcodeBuilder<unknown>) => void): number {
    let builder = new StdOpcodeBuilder(compiler);
    callback(builder);
    return builder.commit();
  }

  readonly constants: CompileTimeConstants;
  readonly encoder: Encoder;
  protected instructionEncoder = new InstructionEncoder([]);

  public compiler: Compiler<this, Locator>;

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
}

export abstract class OpcodeBuilderImpl<Locator = unknown> extends StdOpcodeBuilder<Locator>
  implements OpcodeBuilder<Locator> {
  public stdLib: STDLib;
  public component: ComponentBuilder = new ComponentBuilderImpl(this);
  readonly resolver: Compiler<this, Locator>;

  abstract isEager: boolean;

  constructor(
    resolver: Compiler<OpcodeBuilder<Locator>, Locator>,
    readonly meta: ContainingMetadata<Locator>
  ) {
    // containingLayout ? containingLayout.block.symbols.length : 0
    super(resolver, meta.size);
    this.resolver = resolver as Compiler<this, Locator>;

    this.stdLib = resolver.stdLib;
  }

  /// MECHANICS

  push(name: Op, ...args: BuilderOperands): void {
    this.encoder.push(name, ...args);
  }

  pushMachine(name: MachineOp, ...args: Operands): void {
    this.encoder.pushMachine(name, ...args);
  }

  /// CONVENIENCE

  wrappedComponent(layout: LayoutWithContext<Locator>, attrsBlockNumber: number) {
    labels(this.encoder, () => {
      this.withSavedRegister($s1, () => {
        this.encoder.push(Op.GetComponentTagName, $s0);
        this.encoder.push(Op.PrimitiveReference);

        this.encoder.push(Op.Dup, $sp, 0);
      });

      reserveTarget(this.encoder, Op.JumpUnless, 'BODY');

      this.encoder.push(Op.Fetch, $s1);
      this.encoder.isComponentAttrs = true;
      this.encoder.push(Op.PutComponentOperations);
      this.encoder.push(Op.OpenDynamicElement);
      this.encoder.push(Op.DidCreateElement, $s0);
      yieldBlock(this.encoder, this.resolver, this.compiler, this.meta, attrsBlockNumber, []);
      this.encoder.isComponentAttrs = false;
      this.encoder.push(Op.FlushElement);

      label(this.encoder, 'BODY');

      invokeStaticBlock(this.encoder, this.compiler, blockFor(layout, this.compiler));

      this.encoder.push(Op.Fetch, $s1);
      reserveTarget(this.encoder, Op.JumpUnless, 'END');
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
        this.encoder.push(Op.PushComponentDefinition, { type: 'handle', value: handle });
        invokeStaticComponent(this.encoder, this.resolver, this.compiler, this.meta, {
          capabilities,
          layout: compilable,
          attrs: null,
          params,
          hash,
          synthetic: false,
          blocks,
        });
      } else {
        this.encoder.push(Op.PushComponentDefinition, { type: 'handle', value: handle });
        invokeComponent(this.encoder, this.resolver, this.compiler, this.meta, {
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
      this.meta.referrer
    );

    if (handle !== null && capabilities !== null) {
      if (compilable) {
        if (hash) {
          for (let i = 0; i < hash.length; i = i + 2) {
            hash[i][0] = `@${hash[i][0]}`;
          }
        }

        this.encoder.push(Op.PushComponentDefinition, { type: 'handle', value: handle });
        invokeStaticComponent(this.encoder, this.resolver, this.compiler, this.meta, {
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
    compileArgs(
      this.encoder,
      this.resolver,
      this.compiler,
      this.meta,
      params,
      hash,
      EMPTY_BLOCKS,
      true
    );
    this.encoder.push(Op.Helper, { type: 'handle', value: handle });
    this.encoder.pushMachine(MachineOp.PopFrame);
    this.encoder.push(Op.Fetch, $v0);
  }

  bindDynamicScope(_names: string[]) {
    this.encoder.push(Op.BindDynamicScope, { type: 'string-array', value: _names });
  }

  // convenience methods

  inlineBlock(block: SerializedInlineBlock): CompilableBlock {
    return new CompilableBlockInstance(this.compiler, block, this.meta);
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
  let block = {
    statements: layout.block.statements,
    parameters: EMPTY_ARRAY,
  };

  return new CompilableBlockInstance(compiler, block, meta(layout));
}
