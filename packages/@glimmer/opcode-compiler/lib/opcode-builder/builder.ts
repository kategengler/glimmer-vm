import {
  Option,
  CompilableBlock,
  CompileTimeLazyConstants,
  STDLib,
  ContainingMetadata,
  CompilationResolver,
} from '@glimmer/interfaces';
import { Op, $v0, MachineOp } from '@glimmer/vm';
import * as WireFormat from '@glimmer/wire-format';

import { ComponentArgs } from '../interfaces';

import { InstructionEncoder } from '@glimmer/encoder';
import { NamedBlocksImpl, EMPTY_BLOCKS } from '../utils';
import OpcodeBuilder, {
  BuilderOperands,
  CompileHelper,
  str,
  Operands,
  OpcodeBuilderCompiler,
  OpcodeBuilderEncoder,
  serializable,
} from './interfaces';
import { EncoderImpl } from './encoder';
import { invokeComponent, invokeStaticComponent, compileArgs } from './helpers';

export class StdLib {
  constructor(
    public main: number,
    private trustingGuardedAppend: number,
    private cautiousGuardedAppend: number
  ) {}

  getAppend(trusting: boolean) {
    return trusting ? this.trustingGuardedAppend : this.cautiousGuardedAppend;
  }
}

export abstract class OpcodeBuilderImpl<Locator> implements OpcodeBuilder<Locator> {
  readonly stdLib: STDLib;
  readonly resolver: CompilationResolver<Locator>;
  readonly encoder: OpcodeBuilderEncoder;

  abstract isEager: boolean;

  constructor(
    readonly compiler: OpcodeBuilderCompiler<Locator>,
    readonly meta: ContainingMetadata<Locator>
  ) {
    this.resolver = compiler;
    this.encoder = new EncoderImpl(new InstructionEncoder([]), compiler.constants);
    this.stdLib = compiler.stdLib;
  }

  /// MECHANICS

  push(name: Op, ...args: BuilderOperands): void {
    this.encoder.push(name, ...args);
  }

  pushMachine(name: MachineOp, ...args: Operands): void {
    this.encoder.pushMachine(name, ...args);
  }

  /// CONVENIENCE

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
    this.encoder.push(Op.ResolveDynamicComponent, serializable(referrer));
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
    this.encoder.push(Op.Text, str(text));
  }

  protected openPrimitiveElement(tag: string) {
    this.encoder.push(Op.OpenElement, str(tag));
  }

  protected comment(_comment: string) {
    let comment = str(_comment);
    this.encoder.push(Op.Comment, comment);
  }

  dynamicAttr(_name: string, _namespace: Option<string>, trusting: boolean) {
    let name = str(_name);
    let namespace = _namespace ? str(_namespace) : 0;

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
}

export default OpcodeBuilderImpl;

export class LazyOpcodeBuilder<Locator> extends OpcodeBuilderImpl<Locator> {
  public constants!: CompileTimeLazyConstants; // Hides property on base class

  readonly isEager = false;
}

export class EagerOpcodeBuilder<Locator> extends OpcodeBuilderImpl<Locator>
  implements OpcodeBuilder<Locator> {
  readonly isEager = true;
}
