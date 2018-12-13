import {
  Option,
  Opaque,
  Compiler,
  NamedBlocks as INamedBlocks,
  CompilationResolver,
  ContainingMetadata,
} from '@glimmer/interfaces';
import { assert, dict, unwrap, EMPTY_ARRAY } from '@glimmer/util';
import { $fp, Op, $s0, MachineOp, $sp } from '@glimmer/vm';
import * as WireFormat from '@glimmer/wire-format';
import * as ClientSide from './client-side';
import OpcodeBuilder, { str } from './opcode-builder/interfaces';

import Ops = WireFormat.Ops;
import S = WireFormat.Statements;
import E = WireFormat.Expressions;
import C = WireFormat.Core;
import { EMPTY_BLOCKS } from './utils';
import { constant } from './opcode-builder/builder';
import {
  dynamicScope,
  pushPrimitiveReference,
  label,
  reserveMachineTarget,
  replayable,
  replayableIf,
  staticAttr,
  startDebugger,
  hasBlockParams,
  helper,
  expr,
  curryComponent,
  modifier,
  invokeComponent,
  invokeStaticComponent,
  yieldBlock,
  guardedAppend,
  invokeStaticBlock,
  remoteElement,
  invokeDynamicComponent,
  reserveTarget,
  list,
  invokePartial,
  params,
} from './opcode-builder/helpers';
import { Encoder } from './opcode-builder/encoder';

export type TupleSyntax = WireFormat.Statement | WireFormat.TupleExpression;
export type CompilerFunction<T extends TupleSyntax> = ((sexp: T, builder: OpcodeBuilder) => void);
export type NewCompilerFunction<T extends TupleSyntax, Locator> = ((
  sexp: T,
  encoder: Encoder,
  resolver: CompilationResolver<Locator>,
  compiler: Compiler,
  meta: ContainingMetadata<Locator>
) => void);
export type LeafCompilerFunction<T extends TupleSyntax, Locator> = ((
  sexp: T,
  encoder: Encoder,
  meta: ContainingMetadata<Locator>
) => void);
export type RegisteredSyntax<T extends TupleSyntax, Locator> =
  | { type: 'full'; f: CompilerFunction<T> }
  | { type: 'leaf'; f: LeafCompilerFunction<T, Locator> }
  | { type: 'mini'; f: NewCompilerFunction<T, Locator> };

export const ATTRS_BLOCK = '&attrs';

export class Compilers<Syntax extends TupleSyntax, Locator = unknown> {
  private names = dict<number>();
  private funcs: RegisteredSyntax<Syntax, Locator>[] = [];

  constructor(private offset = 0) {}

  add<T extends Syntax>(name: number, func: CompilerFunction<T>): void {
    this.funcs.push({ type: 'full', f: func as CompilerFunction<Syntax> });
    this.names[name] = this.funcs.length - 1;
  }

  addSimple<T extends Syntax>(name: number, func: NewCompilerFunction<T, Locator>): void {
    this.funcs.push({ type: 'mini', f: func as NewCompilerFunction<Syntax, Locator> });
    this.names[name] = this.funcs.length - 1;
  }

  addLeaf<T extends Syntax>(name: number, func: LeafCompilerFunction<T, Locator>): void {
    this.funcs.push({ type: 'leaf', f: func as LeafCompilerFunction<Syntax, Locator> });
    this.names[name] = this.funcs.length - 1;
  }

  compileSimple(
    sexp: Syntax,
    encoder: Encoder,
    resolver: CompilationResolver<Locator>,
    compiler: Compiler<unknown, Locator>,
    meta: ContainingMetadata<Locator>
  ): void {
    let name: number = sexp![this.offset];
    let index = this.names[name];
    let func = this.funcs[index];
    assert(
      !!func,
      `expected an implementation for ${
        this.offset === 0 ? Ops[sexp![0]] : ClientSide.Ops[sexp![1]]
      }`
    );

    if (func.type !== 'mini') {
      throw new Error('Expressions must be compiled in the new style');
    }

    func.f(sexp as Syntax, encoder, resolver, compiler, meta);
  }

  compile(sexp: Syntax, builder: OpcodeBuilder<Locator>): void {
    let name: number = sexp[this.offset];
    let index = this.names[name];
    let func = this.funcs[index];
    assert(
      !!func,
      `expected an implementation for ${this.offset === 0 ? Ops[sexp[0]] : ClientSide.Ops[sexp[1]]}`
    );

    if (func.type === 'full') {
      func.f(sexp, builder);
    } else if (func.type === 'leaf') {
      func.f(sexp, builder.encoder, builder.meta);
    } else {
      func.f(sexp, builder.encoder, builder.resolver, builder.compiler, builder.meta);
    }
  }
}

let _statementCompiler: Compilers<WireFormat.Statement, unknown>;

export function statementCompiler(): Compilers<WireFormat.Statement, unknown> {
  if (_statementCompiler) {
    return _statementCompiler;
  }

  const STATEMENTS = (_statementCompiler = new Compilers<WireFormat.Statement, unknown>());

  STATEMENTS.addLeaf(Ops.Text, (sexp: S.Text, encoder) => {
    encoder.push(Op.Text, { type: 'string', value: sexp[1] });
  });

  STATEMENTS.addLeaf(Ops.Comment, (sexp: S.Comment, encoder) => {
    encoder.push(Op.Comment, { type: 'string', value: sexp[1] });
  });

  STATEMENTS.addLeaf(Ops.CloseElement, (_sexp, encoder) => {
    encoder.push(Op.CloseElement);
  });

  STATEMENTS.addLeaf(Ops.FlushElement, (_sexp, encoder) => {
    encoder.push(Op.FlushElement);
  });

  STATEMENTS.addSimple(Ops.Modifier, (sexp: S.Modifier, encoder, resolver, compiler, meta) => {
    let { referrer } = meta;
    let [, name, params, hash] = sexp;

    let handle = resolver.resolveModifier(name, referrer);

    if (handle !== null) {
      modifier(encoder, resolver, compiler, meta, { handle, params, hash });
    } else {
      throw new Error(
        `Compile Error ${name} is not a modifier: Helpers may not be used in the element form.`
      );
    }
  });

  STATEMENTS.addLeaf(Ops.StaticAttr, (sexp: S.StaticAttr, encoder) => {
    let [, name, value, namespace] = sexp;
    staticAttr(encoder, name, namespace, value as string);
  });

  STATEMENTS.addSimple(
    Ops.DynamicAttr,
    (sexp: S.DynamicAttr, encoder, resolver, compiler, meta) => {
      dynamicAttr(encoder, resolver, compiler, meta, sexp, false);
    }
  );

  STATEMENTS.addSimple(
    Ops.TrustingAttr,
    (sexp: S.DynamicAttr, encoder, resolver, compiler, meta) => {
      dynamicAttr(encoder, resolver, compiler, meta, sexp, true);
    }
  );

  STATEMENTS.addLeaf(Ops.OpenElement, (sexp: S.OpenElement, encoder) => {
    encoder.push(Op.OpenElement, str(sexp[1]));
  });

  STATEMENTS.addLeaf(Ops.OpenSplattedElement, (sexp: S.SplatElement, encoder) => {
    encoder.isComponentAttrs = true;
    encoder.push(Op.PutComponentOperations);
    encoder.push(Op.OpenElement, str(sexp[1]));
  });

  STATEMENTS.add(Ops.DynamicComponent, (sexp: S.DynamicComponent, builder) => {
    let [, definition, attrs, args, blocks] = sexp;

    let attrsBlock = null;
    if (attrs.length > 0) {
      let wrappedAttrs: WireFormat.Statement[] = [
        [Ops.ClientSideStatement, ClientSide.Ops.SetComponentAttrs, true],
        ...attrs,
        [Ops.ClientSideStatement, ClientSide.Ops.SetComponentAttrs, false],
      ];

      attrsBlock = builder.inlineBlock({ statements: wrappedAttrs, parameters: EMPTY_ARRAY });
    }

    invokeDynamicComponent(builder.encoder, builder.resolver, builder.compiler, builder.meta, {
      definition,
      attrs: attrsBlock,
      params: null,
      hash: args,
      synthetic: false,
      blocks: builder.templates(blocks),
    });
  });

  STATEMENTS.add(Ops.Component, (sexp: S.Component, builder) => {
    let [, tag, _attrs, args, blocks] = sexp;
    let { referrer } = builder.meta;

    let { handle, capabilities, compilable } = builder.resolver.resolveLayoutForTag(tag, referrer);

    if (handle !== null && capabilities !== null) {
      let attrs: WireFormat.Statement[] = [
        [Ops.ClientSideStatement, ClientSide.Ops.SetComponentAttrs, true],
        ..._attrs,
        [Ops.ClientSideStatement, ClientSide.Ops.SetComponentAttrs, false],
      ];
      let attrsBlock = builder.inlineBlock({ statements: attrs, parameters: EMPTY_ARRAY });

      if (compilable) {
        builder.push(Op.PushComponentDefinition, constant.handle(handle));
        invokeStaticComponent(builder.encoder, builder.resolver, builder.compiler, builder.meta, {
          capabilities,
          layout: compilable,
          attrs: attrsBlock,
          params: null,
          hash: args,
          synthetic: false,
          blocks: builder.templates(blocks),
        });
      } else {
        builder.push(Op.PushComponentDefinition, constant.handle(handle));
        invokeComponent(builder.encoder, builder.resolver, builder.compiler, builder.meta, {
          capabilities,
          attrs: attrsBlock,
          params: null,
          hash: args,
          synthetic: false,
          blocks: builder.templates(blocks),
        });
      }
    } else {
      throw new Error(`Compile Error: Cannot find component ${tag}`);
    }
  });

  STATEMENTS.addSimple(Ops.Partial, (sexp: S.Partial, encoder, resolver, compiler, meta) => {
    let [, name, evalInfo] = sexp;

    let { referrer } = meta;

    replayableIf(encoder, {
      args() {
        expr(encoder, resolver, compiler, meta, name);
        encoder.push(Op.Dup, $sp, 0);
        return 2;
      },

      ifTrue() {
        invokePartial(encoder, referrer, meta.evalSymbols!, evalInfo);
        encoder.push(Op.PopScope);
        encoder.pushMachine(MachineOp.PopFrame);
      },
    });
  });

  STATEMENTS.addSimple(
    Ops.Yield,
    (sexp: WireFormat.Statements.Yield, encoder, resolver, compiler, meta) => {
      let [, to, params] = sexp;

      yieldBlock(encoder, resolver, compiler, meta, to, params);
    }
  );

  STATEMENTS.addSimple(
    Ops.AttrSplat,
    (sexp: WireFormat.Statements.AttrSplat, encoder, resolver, compiler, meta) => {
      let [, to] = sexp;

      yieldBlock(encoder, resolver, compiler, meta, to, []);
      encoder.isComponentAttrs = false;
    }
  );

  STATEMENTS.addSimple(
    Ops.Debugger,
    (sexp: WireFormat.Statements.Debugger, encoder, _resolver, _compiler, meta) => {
      let [, evalInfo] = sexp;

      startDebugger(encoder, meta.evalSymbols!, evalInfo);
    }
  );

  STATEMENTS.addSimple(
    Ops.ClientSideStatement,
    (sexp: WireFormat.Statements.ClientSide, encoder, resolver, compiler, meta) => {
      CLIENT_SIDE.compileSimple(
        sexp as ClientSide.ClientSideStatement,
        encoder,
        resolver,
        compiler,
        meta
      );
    }
  );

  STATEMENTS.add(Ops.Append, (sexp: S.Append, builder) => {
    let [, value, trusting] = sexp;

    let returned = builder.compiler.compileInline(sexp, builder) || value;

    if (returned === true) return;

    guardedAppend(
      builder.encoder,
      builder.resolver,
      builder.compiler,
      builder.meta,
      builder.stdLib,
      value,
      trusting
    );
  });

  STATEMENTS.add(Ops.Block, (sexp: S.Block, builder) => {
    let [, name, params, hash, named] = sexp;

    builder.compiler.compileBlock(name, params, hash, builder.templates(named), builder);
  });

  const CLIENT_SIDE = new Compilers<ClientSide.ClientSideStatement, unknown>(1);

  CLIENT_SIDE.addSimple(
    ClientSide.Ops.OpenComponentElement,
    (sexp: ClientSide.OpenComponentElement, encoder) => {
      encoder.push(Op.PutComponentOperations);
      encoder.push(Op.OpenElement, constant.string(sexp[2]));
    }
  );

  CLIENT_SIDE.addSimple(ClientSide.Ops.DidCreateElement, (_sexp, encoder) => {
    encoder.push(Op.DidCreateElement, $s0);
  });

  CLIENT_SIDE.addSimple(
    ClientSide.Ops.SetComponentAttrs,
    (sexp: ClientSide.SetComponentAttrs, encoder) => {
      encoder.isComponentAttrs = sexp[2];
    }
  );

  CLIENT_SIDE.addSimple(ClientSide.Ops.Debugger, () => {
    // tslint:disable-next-line:no-debugger
    debugger;
  });

  CLIENT_SIDE.addSimple(ClientSide.Ops.DidRenderLayout, (_sexp, encoder) => {
    encoder.push(Op.DidRenderLayout, $s0);
  });

  return STATEMENTS;
}

function dynamicAttr<Locator>(
  encoder: Encoder,
  resolver: CompilationResolver<Locator>,
  compiler: Compiler<unknown, Locator>,
  meta: ContainingMetadata<Locator>,
  sexp: S.DynamicAttr | S.TrustingAttr,
  trusting: boolean
) {
  let [, name, value, namespace] = sexp;

  expr(encoder, resolver, compiler, meta, value);

  if (namespace) {
    finishDynamicAttr(encoder, name, namespace, trusting);
  } else {
    finishDynamicAttr(encoder, name, null, trusting);
  }
}

export function finishDynamicAttr(
  encoder: Encoder,
  _name: string,
  _namespace: Option<string>,
  trusting: boolean
) {
  let name = str(_name);
  let namespace = _namespace ? str(_namespace) : 0;

  if (encoder.isComponentAttrs) {
    encoder.push(Op.ComponentAttr, name, trusting === true ? 1 : 0, namespace);
  } else {
    encoder.push(Op.DynamicAttr, name, trusting === true ? 1 : 0, namespace);
  }
}

let _expressionCompiler: Compilers<WireFormat.TupleExpression>;

export function expressionCompiler(): Compilers<WireFormat.TupleExpression> {
  if (_expressionCompiler) {
    return _expressionCompiler;
  }

  const EXPRESSIONS = (_expressionCompiler = new Compilers<WireFormat.TupleExpression>());

  EXPRESSIONS.addSimple(Ops.Unknown, (sexp: E.Unknown, encoder, resolver, compiler, meta) => {
    let name = sexp[1];

    let handle = resolver.resolveHelper(name, meta.referrer);

    if (handle !== null) {
      helper(encoder, resolver, compiler, meta, { handle, params: null, hash: null });
    } else if (meta.asPartial) {
      encoder.push(Op.ResolveMaybeLocal, constant.string(name));
    } else {
      encoder.push(Op.GetVariable, 0);
      encoder.push(Op.GetProperty, constant.string(name));
    }
  });

  EXPRESSIONS.addSimple(Ops.Concat, (sexp: E.Concat, encoder, resolver, compiler, meta) => {
    let parts = sexp[1];
    for (let i = 0; i < parts.length; i++) {
      expr(encoder, resolver, compiler, meta, parts[i]);
    }
    encoder.push(Op.Concat, parts.length);
  });

  EXPRESSIONS.addSimple(Ops.Helper, (sexp: E.Helper, encoder, resolver, compiler, meta) => {
    let [, name, params, hash] = sexp;

    // TODO: triage this in the WF compiler
    if (name === 'component') {
      assert(params.length, 'SYNTAX ERROR: component helper requires at least one argument');

      let [definition, ...restArgs] = params;
      curryComponent(encoder, resolver, compiler, meta, {
        definition,
        params: restArgs,
        hash,
        synthetic: true,
      });
      return;
    }

    let handle = resolver.resolveHelper(name, meta.referrer);

    if (handle !== null) {
      helper(encoder, resolver, compiler, meta, { handle, params, hash });
    } else {
      throw new Error(`Compile Error: ${name} is not a helper`);
    }
  });

  EXPRESSIONS.addSimple(Ops.Get, (sexp: E.Get, encoder) => {
    let [, head, path] = sexp;
    encoder.push(Op.GetVariable, head);
    for (let i = 0; i < path.length; i++) {
      encoder.push(Op.GetProperty, str(path[i]));
    }
  });

  EXPRESSIONS.addSimple(
    Ops.MaybeLocal,
    (sexp: E.MaybeLocal, encoder, _resolver, _compiler, meta) => {
      let [, path] = sexp;

      if (meta.asPartial) {
        let head = path[0];
        path = path.slice(1);

        encoder.push(Op.ResolveMaybeLocal, constant.string(head));
      } else {
        encoder.push(Op.GetVariable, 0);
      }

      for (let i = 0; i < path.length; i++) {
        encoder.push(Op.GetProperty, constant.string(path[i]));
      }
    }
  );

  EXPRESSIONS.addSimple(Ops.Undefined, (_sexp, encoder) => {
    return pushPrimitiveReference(encoder, undefined);
  });

  EXPRESSIONS.addSimple(Ops.HasBlock, (sexp: E.HasBlock, encoder) => {
    encoder.push(Op.HasBlock, sexp[1]);
  });

  EXPRESSIONS.addSimple(
    Ops.HasBlockParams,
    (sexp: E.HasBlockParams, encoder, _resolver, compiler, _meta) => {
      hasBlockParams(encoder, compiler.isEager, sexp[1]);
    }
  );

  return EXPRESSIONS;
}

export class Macros {
  public blocks: Blocks;
  public inlines: Inlines;

  constructor() {
    let { blocks, inlines } = populateBuiltins();
    this.blocks = blocks;
    this.inlines = inlines;
  }
}

export type BlockMacro = (
  params: C.Params,
  hash: C.Hash,
  blocks: INamedBlocks,
  builder: OpcodeBuilder<unknown>
) => void;

export type MissingBlockMacro = (
  name: string,
  params: C.Params,
  hash: C.Hash,
  blocks: INamedBlocks,
  builder: OpcodeBuilder<unknown>
) => boolean | void;

export class Blocks {
  private names = dict<number>();
  private funcs: BlockMacro[] = [];
  private missing: MissingBlockMacro | undefined;

  add(name: string, func: BlockMacro) {
    this.funcs.push(func as BlockMacro);
    this.names[name] = this.funcs.length - 1;
  }

  addMissing(func: MissingBlockMacro) {
    this.missing = func as MissingBlockMacro;
  }

  compile(
    name: string,
    params: C.Params,
    hash: C.Hash,
    blocks: INamedBlocks,
    builder: OpcodeBuilder
  ): void {
    let index = this.names[name];

    if (index === undefined) {
      assert(!!this.missing, `${name} not found, and no catch-all block handler was registered`);
      let func = this.missing!;
      let handled = func(name, params, hash, blocks, builder);
      assert(!!handled, `${name} not found, and the catch-all block handler didn't handle it`);
    } else {
      let func = this.funcs[index];
      func(params, hash, blocks, builder);
    }
  }
}

export type AppendSyntax = S.Append;
export type AppendMacro<Locator> = (
  name: string,
  params: Option<C.Params>,
  hash: Option<C.Hash>,
  builder: OpcodeBuilder<Locator>
) => ['expr', WireFormat.Expression] | true | false;

export class Inlines {
  private names = dict<number>();
  private funcs: AppendMacro<Opaque>[] = [];
  private missing: AppendMacro<Opaque> | undefined;

  add<Locator>(name: string, func: AppendMacro<Locator>) {
    this.funcs.push(func as AppendMacro<Opaque>);
    this.names[name] = this.funcs.length - 1;
  }

  addMissing<Locator>(func: AppendMacro<Locator>) {
    this.missing = func as AppendMacro<Opaque>;
  }

  compile<Locator>(
    sexp: AppendSyntax,
    builder: OpcodeBuilder<Locator>
  ): ['expr', WireFormat.Expression] | true {
    let value = sexp[1];

    // TODO: Fix this so that expression macros can return
    // things like components, so that {{component foo}}
    // is the same as {{(component foo)}}

    if (!Array.isArray(value)) return ['expr', value];

    let name: string;
    let params: Option<C.Params>;
    let hash: Option<C.Hash>;

    if (value[0] === Ops.Helper) {
      name = value[1];
      params = value[2];
      hash = value[3];
    } else if (value[0] === Ops.Unknown) {
      name = value[1];
      params = hash = null;
    } else {
      return ['expr', value];
    }

    let index = this.names[name];

    if (index === undefined && this.missing) {
      let func = this.missing;
      let returned = func(name, params, hash, builder);
      return returned === false ? ['expr', value] : returned;
    } else if (index !== undefined) {
      let func = this.funcs[index];
      let returned = func(name, params, hash, builder);
      return returned === false ? ['expr', value] : returned;
    } else {
      return ['expr', value];
    }
  }
}

export function populateBuiltins(
  blocks: Blocks = new Blocks(),
  inlines: Inlines = new Inlines()
): { blocks: Blocks; inlines: Inlines } {
  blocks.add('if', (params, _hash, blocks, builder) => {
    //        PutArgs
    //        Test(Environment)
    //        Enter(BEGIN, END)
    // BEGIN: Noop
    //        JumpUnless(ELSE)
    //        Evaluate(default)
    //        Jump(END)
    // ELSE:  Noop
    //        Evalulate(else)
    // END:   Noop
    //        Exit

    if (!params || params.length !== 1) {
      throw new Error(`SYNTAX ERROR: #if requires a single argument`);
    }

    replayableIf(builder.encoder, {
      args() {
        expr(builder.encoder, builder.resolver, builder.compiler, builder.meta, params[0]);
        builder.toBoolean();
        return 1;
      },

      ifTrue() {
        invokeStaticBlock(builder.encoder, builder.compiler, unwrap(blocks.get('default')));
      },

      ifFalse() {
        if (blocks.has('else')) {
          invokeStaticBlock(builder.encoder, builder.compiler, blocks.get('else')!);
        }
      },
    });
  });

  blocks.add('unless', (params, _hash, blocks, builder) => {
    //        PutArgs
    //        Test(Environment)
    //        Enter(BEGIN, END)
    // BEGIN: Noop
    //        JumpUnless(ELSE)
    //        Evaluate(default)
    //        Jump(END)
    // ELSE:  Noop
    //        Evalulate(else)
    // END:   Noop
    //        Exit

    if (!params || params.length !== 1) {
      throw new Error(`SYNTAX ERROR: #unless requires a single argument`);
    }

    replayableIf(builder.encoder, {
      args() {
        expr(builder.encoder, builder.resolver, builder.compiler, builder.meta, params[0]);
        builder.toBoolean();
        return 1;
      },

      ifTrue() {
        if (blocks.has('else')) {
          invokeStaticBlock(builder.encoder, builder.compiler, blocks.get('else')!);
        }
      },

      ifFalse() {
        invokeStaticBlock(builder.encoder, builder.compiler, unwrap(blocks.get('default')));
      },
    });
  });

  blocks.add('with', (params, _hash, blocks, builder) => {
    //        PutArgs
    //        Test(Environment)
    //        Enter(BEGIN, END)
    // BEGIN: Noop
    //        JumpUnless(ELSE)
    //        Evaluate(default)
    //        Jump(END)
    // ELSE:  Noop
    //        Evalulate(else)
    // END:   Noop
    //        Exit

    if (!params || params.length !== 1) {
      throw new Error(`SYNTAX ERROR: #with requires a single argument`);
    }

    replayableIf(builder.encoder, {
      args() {
        expr(builder.encoder, builder.resolver, builder.compiler, builder.meta, params[0]);
        builder.push(Op.Dup, $sp, 0);
        builder.toBoolean();
        return 2;
      },

      ifTrue() {
        invokeStaticBlock(builder.encoder, builder.compiler, unwrap(blocks.get('default')), 1);
      },

      ifFalse() {
        if (blocks.has('else')) {
          invokeStaticBlock(builder.encoder, builder.compiler, blocks.get('else')!);
        }
      },
    });
  });

  blocks.add('each', (params, hash, blocks, builder) => {
    //         Enter(BEGIN, END)
    // BEGIN:  Noop
    //         PutArgs
    //         PutIterable
    //         JumpUnless(ELSE)
    //         EnterList(BEGIN2, END2)
    // ITER:   Noop
    //         NextIter(BREAK)
    // BEGIN2: Noop
    //         PushChildScope
    //         Evaluate(default)
    //         PopScope
    // END2:   Noop
    //         Exit
    //         Jump(ITER)
    // BREAK:  Noop
    //         ExitList
    //         Jump(END)
    // ELSE:   Noop
    //         Evalulate(else)
    // END:    Noop
    //         Exit

    replayable(builder.encoder, {
      args() {
        if (hash && hash[0][0] === 'key') {
          expr(builder.encoder, builder.resolver, builder.compiler, builder.meta, hash[1][0]);
        } else {
          pushPrimitiveReference(builder.encoder, null);
        }

        expr(builder.encoder, builder.resolver, builder.compiler, builder.meta, params[0]);

        return 2;
      },

      body() {
        builder.push(Op.PutIterator);

        reserveTarget(builder.encoder, Op.JumpUnless, 'ELSE');

        builder.frame(() => {
          builder.push(Op.Dup, $fp, 1);

          reserveMachineTarget(builder.encoder, MachineOp.ReturnTo, 'ITER');
          list(builder.encoder, 'BODY', () => {
            label(builder.encoder, 'ITER');
            builder.iterate('BREAK');

            label(builder.encoder, 'BODY');
            invokeStaticBlock(builder.encoder, builder.compiler, unwrap(blocks.get('default')), 2);
            builder.pop(2);
            builder.jump('FINALLY');

            label(builder.encoder, 'BREAK');
          });
        });

        builder.jump('FINALLY');
        label(builder.encoder, 'ELSE');

        if (blocks.has('else')) {
          invokeStaticBlock(builder.encoder, builder.compiler, blocks.get('else')!);
        }
      },
    });
  });

  blocks.add('in-element', (params, hash, blocks, builder) => {
    if (!params || params.length !== 1) {
      throw new Error(`SYNTAX ERROR: #in-element requires a single argument`);
    }

    replayableIf(builder.encoder, {
      args() {
        let [keys, values] = hash!;

        for (let i = 0; i < keys.length; i++) {
          let key = keys[i];
          if (key === 'nextSibling' || key === 'guid') {
            expr(builder.encoder, builder.resolver, builder.compiler, builder.meta, values[i]);
          } else {
            throw new Error(`SYNTAX ERROR: #in-element does not take a \`${keys[0]}\` option`);
          }
        }

        expr(builder.encoder, builder.resolver, builder.compiler, builder.meta, params[0]);

        builder.push(Op.Dup, $sp, 0);

        return 4;
      },

      ifTrue() {
        remoteElement(builder.encoder, () =>
          invokeStaticBlock(builder.encoder, builder.compiler, unwrap(blocks.get('default')))
        );
      },
    });
  });

  blocks.add('-with-dynamic-vars', (_params, hash, blocks, builder) => {
    if (hash) {
      let [names, expressions] = hash;

      params(builder.encoder, builder.resolver, builder.compiler, builder.meta, expressions);

      dynamicScope(builder.encoder, names, () => {
        invokeStaticBlock(builder.encoder, builder.compiler, unwrap(blocks.get('default')));
      });
    } else {
      invokeStaticBlock(builder.encoder, builder.compiler, unwrap(blocks.get('default')));
    }
  });

  blocks.add('component', (_params, hash, blocks, builder) => {
    assert(_params && _params.length, 'SYNTAX ERROR: #component requires at least one argument');

    let tag = _params[0];
    if (typeof tag === 'string') {
      let returned = builder.staticComponentHelper(
        _params[0] as string,
        hash,
        blocks.get('default')
      );
      if (returned) return;
    }

    let [definition, ...params] = _params!;
    invokeDynamicComponent(builder.encoder, builder.resolver, builder.compiler, builder.meta, {
      definition,
      attrs: null,
      params,
      hash,
      synthetic: true,
      blocks,
    });
  });

  inlines.add('component', (_name, _params, hash, builder) => {
    assert(
      _params && _params.length,
      'SYNTAX ERROR: component helper requires at least one argument'
    );

    let tag = _params && _params[0];
    if (typeof tag === 'string') {
      let returned = builder.staticComponentHelper(tag as string, hash, null);
      if (returned) return true;
    }

    let [definition, ...params] = _params!;
    invokeDynamicComponent(builder.encoder, builder.resolver, builder.compiler, builder.meta, {
      definition,
      attrs: null,
      params,
      hash,
      synthetic: true,
      blocks: EMPTY_BLOCKS,
    });

    return true;
  });

  return { blocks, inlines };
}

export interface CompileOptions<Locator, Builder = Opaque> {
  compiler: Compiler<Builder>;
  asPartial: boolean;
  referrer: Locator;
}
