import {
  Option,
  Opaque,
  NamedBlocks as INamedBlocks,
  CompileTimeLookup,
  ContainingMetadata,
} from '@glimmer/interfaces';
import { assert, dict, unwrap, EMPTY_ARRAY } from '@glimmer/util';
import { $fp, Op, $s0, MachineOp, $sp } from '@glimmer/vm';
import * as WireFormat from '@glimmer/wire-format';
import * as ClientSide from './client-side';
import OpcodeBuilder, {
  str,
  handle,
  OpcodeBuilderCompiler,
  OpcodeBuilderEncoder,
  serializable,
  strArray,
  arr,
  optionStr,
  bool,
  label,
} from './opcode-builder/interfaces';

import Ops = WireFormat.Ops;
import S = WireFormat.Statements;
import E = WireFormat.Expressions;
import C = WireFormat.Core;
import { EMPTY_BLOCKS } from './utils';
import { resolveLayoutForTag } from './resolver';
import { expr, params } from './opcode-builder/helpers/shared';
import {
  yieldBlock,
  invokeStaticBlock,
  inlineBlock,
  templates,
} from './opcode-builder/helpers/blocks';
import {
  pushPrimitiveReference,
  hasBlockParams,
  frame,
  helper,
  list,
  startDebugger,
  dynamicScope,
} from './opcode-builder/helpers/vm';
import {
  invokeDynamicComponent,
  invokeStaticComponent,
  invokeComponent,
  curryComponent,
  staticComponentHelper,
} from './opcode-builder/helpers/components';
import { guardedAppend } from './opcode-builder/helpers/append';
import { replayableIf, replayable } from './opcode-builder/helpers/conditional';
import { modifier, staticAttr, remoteElement } from './opcode-builder/helpers/dom';

export type TupleSyntax = WireFormat.Statement | WireFormat.TupleExpression;
export type StatementCompilerFunction<T extends TupleSyntax, Locator> = ((
  sexp: T,
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>
) => void);
export type SimpleCompilerFunction<T extends TupleSyntax, Locator> = ((
  sexp: T,
  state: ExprCompilerState<Locator>
) => void);
export type LeafCompilerFunction<T extends TupleSyntax, Locator> = ((
  sexp: T,
  encoder: OpcodeBuilderEncoder,
  meta: ContainingMetadata<Locator>
) => void);
export type RegisteredSyntax<T extends TupleSyntax, Locator> =
  | { type: 'leaf'; f: LeafCompilerFunction<T, Locator> }
  | { type: 'mini'; f: SimpleCompilerFunction<T, Locator> }
  | { type: 'statement'; f: StatementCompilerFunction<T, Locator> };

export const ATTRS_BLOCK = '&attrs';

export interface ExprCompilerState<Locator> {
  encoder: OpcodeBuilderEncoder;
  resolver: CompileTimeLookup<Locator>;
  meta: ContainingMetadata<Locator>;
}

export class ExpressionCompilers<Locator = unknown> {
  private names = dict<number>();
  private funcs: RegisteredSyntax<WireFormat.TupleExpression, Locator>[] = [];

  constructor(private offset = 0) {}

  addSimple<T extends WireFormat.TupleExpression>(
    name: number,
    func: SimpleCompilerFunction<T, Locator>
  ): void {
    this.funcs.push({
      type: 'mini',
      f: func as SimpleCompilerFunction<WireFormat.TupleExpression, Locator>,
    });
    this.names[name] = this.funcs.length - 1;
  }

  addLeaf<T extends WireFormat.TupleExpression>(
    name: number,
    func: LeafCompilerFunction<T, Locator>
  ): void {
    this.funcs.push({
      type: 'leaf',
      f: func as LeafCompilerFunction<WireFormat.TupleExpression, Locator>,
    });
    this.names[name] = this.funcs.length - 1;
  }

  compile(sexp: WireFormat.TupleExpression, state: ExprCompilerState<Locator>): void {
    let name: number = sexp![this.offset];
    let index = this.names[name];
    let func = this.funcs[index];
    assert(
      !!func,
      `expected an implementation for ${
        this.offset === 0 ? Ops[sexp![0]] : ClientSide.Ops[sexp![1]]
      }`
    );

    if (func.type === 'mini') {
      func.f(sexp, state);
    } else if (func.type === 'statement') {
      throw new Error(`Can't compile an expression as a statement`);
    } else {
      func.f(sexp, state.encoder, state.meta);
    }
  }
}

export class Compilers<Syntax extends TupleSyntax, Locator = unknown> {
  private names = dict<number>();
  private funcs: RegisteredSyntax<Syntax, Locator>[] = [];

  constructor(private offset = 0) {}

  addStatement<T extends Syntax>(name: number, func: StatementCompilerFunction<T, Locator>): void {
    this.funcs.push({ type: 'statement', f: func as StatementCompilerFunction<Syntax, Locator> });
    this.names[name] = this.funcs.length - 1;
  }

  addSimple<T extends Syntax>(name: number, func: SimpleCompilerFunction<T, Locator>): void {
    this.funcs.push({ type: 'mini', f: func as SimpleCompilerFunction<Syntax, Locator> });
    this.names[name] = this.funcs.length - 1;
  }

  addLeaf<T extends Syntax>(name: number, func: LeafCompilerFunction<T, Locator>): void {
    this.funcs.push({ type: 'leaf', f: func as LeafCompilerFunction<Syntax, Locator> });
    this.names[name] = this.funcs.length - 1;
  }

  compileSimple(
    sexp: Syntax,
    encoder: OpcodeBuilderEncoder,
    resolver: CompileTimeLookup<Locator>,
    compiler: OpcodeBuilderCompiler<Locator>,
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

    if (func.type === 'mini') {
      func.f(sexp as Syntax, { encoder, resolver, meta });
    } else if (func.type === 'statement') {
      func.f(sexp as Syntax, encoder, resolver, compiler, meta);
    } else {
      func.f(sexp as Syntax, encoder, meta);
    }
  }

  compileStatement(sexp: Syntax, builder: OpcodeBuilder<Locator>): void {
    let name: number = sexp[this.offset];
    let index = this.names[name];
    let func = this.funcs[index];
    assert(
      !!func,
      `expected an implementation for ${this.offset === 0 ? Ops[sexp[0]] : ClientSide.Ops[sexp[1]]}`
    );

    if (func.type === 'leaf') {
      func.f(sexp, builder.encoder, builder.meta);
    } else if (func.type === 'statement') {
      func.f(sexp, builder.encoder, builder.resolver, builder.compiler, builder.meta);
    } else {
      func.f(sexp, builder);
    }
  }

  compile(sexp: Syntax, builder: OpcodeBuilder<Locator>): void {
    let name: number = sexp[this.offset];
    let index = this.names[name];
    let func = this.funcs[index];
    assert(
      !!func,
      `expected an implementation for ${this.offset === 0 ? Ops[sexp[0]] : ClientSide.Ops[sexp[1]]}`
    );

    if (func.type === 'leaf') {
      func.f(sexp, builder.encoder, builder.meta);
    } else if (func.type === 'statement') {
      func.f(sexp, builder.encoder, builder.resolver, builder.compiler, builder.meta);
    } else {
      func.f(sexp, builder);
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

  STATEMENTS.addSimple(Ops.Modifier, (sexp: S.Modifier, state) => {
    let { resolver, meta } = state;
    let [, name, params, hash] = sexp;

    let handle = resolver.lookupModifier(name, meta.referrer);

    if (handle !== null) {
      modifier(state, { handle, params, hash });
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

  STATEMENTS.addSimple(Ops.DynamicAttr, (sexp: S.DynamicAttr, state) => {
    dynamicAttr(state, sexp, false);
  });

  STATEMENTS.addSimple(Ops.ComponentAttr, (sexp: S.DynamicAttr, state) => {
    componentAttr(state, sexp, false);
  });

  STATEMENTS.addSimple(Ops.TrustingAttr, (sexp: S.DynamicAttr, state) => {
    dynamicAttr(state, sexp, true);
  });

  STATEMENTS.addSimple(Ops.TrustingComponentAttr, (sexp: S.DynamicAttr, state) => {
    componentAttr(state, sexp, true);
  });

  STATEMENTS.addLeaf(Ops.OpenElement, (sexp: S.OpenElement, encoder) => {
    encoder.push(Op.OpenElement, str(sexp[1]));
  });

  STATEMENTS.addLeaf(Ops.OpenSplattedElement, (sexp: S.SplatElement, encoder) => {
    // encoder.isComponentAttrs = true;
    encoder.push(Op.PutComponentOperations);
    encoder.push(Op.OpenElement, str(sexp[1]));
  });

  STATEMENTS.addStatement(
    Ops.DynamicComponent,
    (sexp: S.DynamicComponent, encoder, resolver, compiler, meta) => {
      let [, definition, attrs, args, blocks] = sexp;

      let attrsBlock = null;
      if (attrs.length > 0) {
        let wrappedAttrs: WireFormat.Statement[] = [...attrs];

        attrsBlock = inlineBlock(
          { statements: wrappedAttrs, parameters: EMPTY_ARRAY },
          compiler,
          meta
        );
      }

      invokeDynamicComponent(encoder, resolver, compiler, meta, {
        definition,
        attrs: attrsBlock,
        params: null,
        hash: args,
        synthetic: false,
        blocks: templates(blocks, compiler, meta),
      });
    }
  );

  STATEMENTS.addStatement(Ops.Component, (sexp: S.Component, encoder, resolver, compiler, meta) => {
    let [, tag, _attrs, args, blocks] = sexp;
    let { referrer } = meta;

    let { handle: layoutHandle, capabilities, compilable } = resolveLayoutForTag(
      resolver,
      tag,
      referrer
    );

    if (layoutHandle !== null && capabilities !== null) {
      let attrs: WireFormat.Statement[] = [..._attrs];
      let attrsBlock = inlineBlock({ statements: attrs, parameters: EMPTY_ARRAY }, compiler, meta);

      if (compilable) {
        encoder.push(Op.PushComponentDefinition, handle(layoutHandle));
        invokeStaticComponent(encoder, resolver, compiler, meta, {
          capabilities,
          layout: compilable,
          attrs: attrsBlock,
          params: null,
          hash: args,
          synthetic: false,
          blocks: templates(blocks, compiler, meta),
        });
      } else {
        encoder.push(Op.PushComponentDefinition, handle(layoutHandle));
        invokeComponent(encoder, resolver, compiler, meta, {
          capabilities,
          attrs: attrsBlock,
          params: null,
          hash: args,
          synthetic: false,
          blocks: templates(blocks, compiler, meta),
        });
      }
    } else {
      throw new Error(`Compile Error: Cannot find component ${tag}`);
    }
  });

  STATEMENTS.addSimple(Ops.Partial, (sexp: S.Partial, state) => {
    let [, name, evalInfo] = sexp;

    let { encoder, meta } = state;

    replayableIf(encoder, {
      args() {
        expr(name, state);
        encoder.push(Op.Dup, $sp, 0);
        return 2;
      },

      ifTrue() {
        encoder.push(
          Op.InvokePartial,
          serializable(meta.referrer),
          strArray(meta.evalSymbols!),
          arr(evalInfo)
        );

        encoder.push(Op.PopScope);
        encoder.push(MachineOp.PopFrame);
      },
    });
  });

  STATEMENTS.addStatement(
    Ops.Yield,
    (sexp: WireFormat.Statements.Yield, encoder, resolver, compiler, meta) => {
      let [, to, params] = sexp;

      yieldBlock(to, params, encoder, resolver, compiler, meta);
    }
  );

  STATEMENTS.addStatement(
    Ops.AttrSplat,
    (sexp: WireFormat.Statements.AttrSplat, encoder, resolver, compiler, meta) => {
      let [, to] = sexp;

      yieldBlock(to, EMPTY_ARRAY, encoder, resolver, compiler, meta);
      // encoder.isComponentAttrs = false;
    }
  );

  STATEMENTS.addLeaf(Ops.Debugger, (sexp: WireFormat.Statements.Debugger, encoder, meta) => {
    let [, evalInfo] = sexp;

    startDebugger(encoder, meta.evalSymbols!, evalInfo);
  });

  STATEMENTS.addStatement(
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

  STATEMENTS.addStatement(Ops.Append, (sexp: S.Append, encoder, resolver, compiler, meta) => {
    let [, value, trusting] = sexp;

    let returned = compiler.compileInline(sexp, encoder, resolver, meta) || value;

    if (returned === true) return;

    guardedAppend(value, trusting, { encoder, resolver, meta });
  });

  STATEMENTS.addStatement(Ops.Block, (sexp: S.Block, encoder, resolver, compiler, meta) => {
    let [, name, params, hash, named] = sexp;

    compiler.compileBlock(
      name,
      params,
      hash,
      templates(named, compiler, meta),
      encoder,
      resolver,
      compiler,
      meta
    );
  });

  const CLIENT_SIDE = new Compilers<ClientSide.ClientSideStatement, unknown>(1);

  CLIENT_SIDE.addLeaf(
    ClientSide.Ops.OpenComponentElement,
    (sexp: ClientSide.OpenComponentElement, encoder) => {
      encoder.push(Op.PutComponentOperations);
      encoder.push(Op.OpenElement, str(sexp[2]));
    }
  );

  CLIENT_SIDE.addLeaf(ClientSide.Ops.DidCreateElement, (_sexp, encoder) => {
    encoder.push(Op.DidCreateElement, $s0);
  });

  CLIENT_SIDE.addLeaf(ClientSide.Ops.Debugger, () => {
    // tslint:disable-next-line:no-debugger
    debugger;
  });

  CLIENT_SIDE.addLeaf(ClientSide.Ops.DidRenderLayout, (_sexp, encoder) => {
    encoder.push(Op.DidRenderLayout, $s0);
  });

  return STATEMENTS;
}

function dynamicAttr<Locator>(
  state: ExprCompilerState<Locator>,
  sexp: S.DynamicAttr | S.TrustingAttr,
  trusting: boolean
) {
  let [, name, value, namespace] = sexp;

  expr(value, state);

  if (namespace) {
    finishDynamicAttr(state.encoder, name, namespace, trusting);
  } else {
    finishDynamicAttr(state.encoder, name, null, trusting);
  }
}

export function finishDynamicAttr(
  encoder: OpcodeBuilderEncoder,
  name: string,
  namespace: Option<string>,
  trusting: boolean
) {
  encoder.push(Op.DynamicAttr, str(name), bool(trusting), optionStr(namespace));
}

function componentAttr<Locator>(
  state: ExprCompilerState<Locator>,
  sexp: S.DynamicAttr | S.TrustingAttr,
  trusting: boolean
) {
  let [, name, value, namespace] = sexp;

  expr(value, state);

  if (namespace) {
    finishComponentAttr(state.encoder, name, namespace, trusting);
  } else {
    finishComponentAttr(state.encoder, name, null, trusting);
  }
}

export function finishComponentAttr(
  encoder: OpcodeBuilderEncoder,
  name: string,
  namespace: Option<string>,
  trusting: boolean
) {
  encoder.push(Op.ComponentAttr, str(name), bool(trusting), optionStr(namespace));
}

export function compileExpression<Locator>(
  expression: WireFormat.TupleExpression,
  state: ExprCompilerState<Locator>
): void {
  expressionCompiler().compile(expression, state);
}

let _expressionCompiler: ExpressionCompilers<unknown>;

export function expressionCompiler(): ExpressionCompilers<unknown> {
  if (_expressionCompiler) {
    return _expressionCompiler;
  }

  const EXPRESSIONS = (_expressionCompiler = new ExpressionCompilers());

  EXPRESSIONS.addSimple(Ops.Unknown, (sexp: E.Unknown, state) => {
    let name = sexp[1];

    let { encoder, resolver, meta } = state;

    let handle = resolver.lookupHelper(name, meta.referrer);

    if (handle !== null) {
      helper(state, { handle, params: null, hash: null });
    } else if (meta.asPartial) {
      encoder.push(Op.ResolveMaybeLocal, str(name));
    } else {
      encoder.push(Op.GetVariable, 0);
      encoder.push(Op.GetProperty, str(name));
    }
  });

  EXPRESSIONS.addSimple(Ops.Concat, (sexp: E.Concat, state) => {
    let parts = sexp[1];
    for (let i = 0; i < parts.length; i++) {
      expr(parts[i], state);
    }

    state.encoder.push(Op.Concat, parts.length);
  });

  EXPRESSIONS.addSimple(Ops.Helper, (sexp: E.Helper, state) => {
    let [, name, params, hash] = sexp;

    let { resolver, meta } = state;

    // TODO: triage this in the WF compiler
    if (name === 'component') {
      assert(params.length, 'SYNTAX ERROR: component helper requires at least one argument');

      let [definition, ...restArgs] = params;
      curryComponent(state, {
        definition,
        params: restArgs,
        hash,
        synthetic: true,
      });
      return;
    }

    let handle = resolver.lookupHelper(name, meta.referrer);

    if (handle !== null) {
      helper(state, { handle, params, hash });
    } else {
      throw new Error(`Compile Error: ${name} is not a helper`);
    }
  });

  EXPRESSIONS.addLeaf(Ops.Get, (sexp: E.Get, encoder) => {
    let [, head, path] = sexp;
    encoder.push(Op.GetVariable, head);
    for (let i = 0; i < path.length; i++) {
      encoder.push(Op.GetProperty, str(path[i]));
    }
  });

  EXPRESSIONS.addLeaf(Ops.MaybeLocal, (sexp: E.MaybeLocal, encoder, meta) => {
    let [, path] = sexp;

    if (meta.asPartial) {
      let head = path[0];
      path = path.slice(1);

      encoder.push(Op.ResolveMaybeLocal, str(head));
    } else {
      encoder.push(Op.GetVariable, 0);
    }

    for (let i = 0; i < path.length; i++) {
      encoder.push(Op.GetProperty, str(path[i]));
    }
  });

  EXPRESSIONS.addLeaf(Ops.Undefined, (_sexp, encoder) => {
    return pushPrimitiveReference(encoder, undefined);
  });

  EXPRESSIONS.addLeaf(Ops.HasBlock, (sexp: E.HasBlock, encoder) => {
    encoder.push(Op.HasBlock, sexp[1]);
  });

  EXPRESSIONS.addLeaf(Ops.HasBlockParams, (sexp: E.HasBlockParams, encoder) => {
    hasBlockParams(encoder, sexp[1]);
  });

  return EXPRESSIONS;
}

export class Macros<Locator> {
  public blocks: Blocks<Locator>;
  public inlines: Inlines<Locator>;

  constructor() {
    let { blocks, inlines } = populateBuiltins<Locator>();
    this.blocks = blocks;
    this.inlines = inlines;
  }
}

export type BlockMacro<Locator> = (
  params: C.Params,
  hash: C.Hash,
  blocks: INamedBlocks,
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>
) => void;

export type MissingBlockMacro<Locator> = (
  name: string,
  params: C.Params,
  hash: C.Hash,
  blocks: INamedBlocks,
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>
) => boolean | void;

export class Blocks<Locator> {
  private names = dict<number>();
  private funcs: BlockMacro<Locator>[] = [];
  private missing: MissingBlockMacro<Locator> | undefined;

  add(name: string, func: BlockMacro<Locator>) {
    this.funcs.push(func as BlockMacro<Locator>);
    this.names[name] = this.funcs.length - 1;
  }

  addMissing(func: MissingBlockMacro<Locator>) {
    this.missing = func as MissingBlockMacro<Locator>;
  }

  compile(
    name: string,
    params: C.Params,
    hash: C.Hash,
    blocks: INamedBlocks,
    encoder: OpcodeBuilderEncoder,
    resolver: CompileTimeLookup<Locator>,
    compiler: OpcodeBuilderCompiler<Locator>,
    meta: ContainingMetadata<Locator>
  ): void {
    let index = this.names[name];

    if (index === undefined) {
      assert(!!this.missing, `${name} not found, and no catch-all block handler was registered`);
      let func = this.missing!;
      let handled = func(name, params, hash, blocks, encoder, resolver, compiler, meta);
      assert(!!handled, `${name} not found, and the catch-all block handler didn't handle it`);
    } else {
      let func = this.funcs[index];
      func(params, hash, blocks, encoder, resolver, compiler, meta);
    }
  }
}

export type AppendSyntax = S.Append;
export type AppendMacro<Locator> = (
  name: string,
  params: Option<C.Params>,
  hash: Option<C.Hash>,
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>
) => ['expr', WireFormat.Expression] | true | false;

export class Inlines<Locator> {
  private names = dict<number>();
  private funcs: AppendMacro<Locator>[] = [];
  private missing: AppendMacro<Locator> | undefined;

  add(name: string, func: AppendMacro<Locator>) {
    this.funcs.push(func as AppendMacro<Opaque>);
    this.names[name] = this.funcs.length - 1;
  }

  addMissing(func: AppendMacro<Locator>) {
    this.missing = func as AppendMacro<Opaque>;
  }

  compile(
    sexp: AppendSyntax,
    encoder: OpcodeBuilderEncoder,
    compiler: OpcodeBuilderCompiler<Locator>,
    resolver: CompileTimeLookup<Locator>,
    meta: ContainingMetadata<Locator>
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
      let returned = func(name, params, hash, encoder, resolver, compiler, meta);
      return returned === false ? ['expr', value] : returned;
    } else if (index !== undefined) {
      let func = this.funcs[index];
      let returned = func(name, params, hash, encoder, resolver, compiler, meta);
      return returned === false ? ['expr', value] : returned;
    } else {
      return ['expr', value];
    }
  }
}

export function populateBuiltins<Locator>(
  blocks: Blocks<Locator> = new Blocks(),
  inlines: Inlines<Locator> = new Inlines()
): { blocks: Blocks<Locator>; inlines: Inlines<Locator> } {
  blocks.add('if', (params, _hash, blocks, encoder, resolver, compiler, meta) => {
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

    replayableIf(encoder, {
      args() {
        expr(params[0], { encoder, resolver, meta });
        encoder.push(Op.ToBoolean);
        return 1;
      },

      ifTrue() {
        invokeStaticBlock(encoder, compiler, unwrap(blocks.get('default')));
      },

      ifFalse() {
        if (blocks.has('else')) {
          invokeStaticBlock(encoder, compiler, blocks.get('else')!);
        }
      },
    });
  });

  blocks.add('unless', (params, _hash, blocks, encoder, resolver, compiler, meta) => {
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

    replayableIf(encoder, {
      args() {
        expr(params[0], { encoder, resolver, meta });
        encoder.push(Op.ToBoolean);
        return 1;
      },

      ifTrue() {
        if (blocks.has('else')) {
          invokeStaticBlock(encoder, compiler, blocks.get('else')!);
        }
      },

      ifFalse() {
        invokeStaticBlock(encoder, compiler, unwrap(blocks.get('default')));
      },
    });
  });

  blocks.add('with', (params, _hash, blocks, encoder, resolver, compiler, meta) => {
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

    replayableIf(encoder, {
      args() {
        expr(params[0], { encoder, resolver, meta });
        encoder.push(Op.Dup, $sp, 0);
        encoder.push(Op.ToBoolean);
        return 2;
      },

      ifTrue() {
        invokeStaticBlock(encoder, compiler, unwrap(blocks.get('default')), 1);
      },

      ifFalse() {
        if (blocks.has('else')) {
          invokeStaticBlock(encoder, compiler, blocks.get('else')!);
        }
      },
    });
  });

  blocks.add('each', (params, hash, blocks, encoder, resolver, compiler, meta) => {
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

    replayable(encoder, {
      args() {
        if (hash && hash[0][0] === 'key') {
          expr(hash[1][0], { encoder, resolver, meta });
        } else {
          pushPrimitiveReference(encoder, null);
        }

        expr(params[0], { encoder, resolver, meta });

        return 2;
      },

      body() {
        encoder.push(Op.PutIterator);

        encoder.push(Op.JumpUnless, label('ELSE'));

        frame(encoder, () => {
          encoder.push(Op.Dup, $fp, 1);

          encoder.push(MachineOp.ReturnTo, label('ITER'));
          list(encoder, 'BODY', () => {
            encoder.label('ITER');
            encoder.push(Op.Iterate, label('BREAK'));

            encoder.label('BODY');
            invokeStaticBlock(encoder, compiler, unwrap(blocks.get('default')), 2);
            encoder.push(Op.Pop, 2);
            encoder.push(MachineOp.Jump, label('FINALLY'));

            encoder.label('BREAK');
          });
        });

        encoder.push(MachineOp.Jump, label('FINALLY'));
        encoder.label('ELSE');

        if (blocks.has('else')) {
          invokeStaticBlock(encoder, compiler, blocks.get('else')!);
        }
      },
    });
  });

  blocks.add('in-element', (params, hash, blocks, encoder, resolver, compiler, meta) => {
    if (!params || params.length !== 1) {
      throw new Error(`SYNTAX ERROR: #in-element requires a single argument`);
    }

    replayableIf(encoder, {
      args() {
        let [keys, values] = hash!;

        for (let i = 0; i < keys.length; i++) {
          let key = keys[i];
          if (key === 'nextSibling' || key === 'guid') {
            expr(values[i], { encoder, resolver, meta });
          } else {
            throw new Error(`SYNTAX ERROR: #in-element does not take a \`${keys[0]}\` option`);
          }
        }

        expr(params[0], { encoder, resolver, meta });

        encoder.push(Op.Dup, $sp, 0);

        return 4;
      },

      ifTrue() {
        remoteElement(encoder, () =>
          invokeStaticBlock(encoder, compiler, unwrap(blocks.get('default')))
        );
      },
    });
  });

  blocks.add('-with-dynamic-vars', (_params, hash, blocks, encoder, resolver, compiler, meta) => {
    if (hash) {
      let [names, expressions] = hash;

      params(expressions, { encoder, resolver, meta });

      dynamicScope(encoder, names, () => {
        invokeStaticBlock(encoder, compiler, unwrap(blocks.get('default')));
      });
    } else {
      invokeStaticBlock(encoder, compiler, unwrap(blocks.get('default')));
    }
  });

  blocks.add('component', (_params, hash, blocks, encoder, resolver, compiler, meta) => {
    assert(_params && _params.length, 'SYNTAX ERROR: #component requires at least one argument');

    let tag = _params[0];
    if (typeof tag === 'string') {
      let returned = staticComponentHelper(
        encoder,
        resolver,
        compiler,
        meta,
        _params[0] as string,
        hash,
        blocks.get('default')
      );
      if (returned) return;
    }

    let [definition, ...params] = _params!;
    invokeDynamicComponent(encoder, resolver, compiler, meta, {
      definition,
      attrs: null,
      params,
      hash,
      synthetic: true,
      blocks,
    });
  });

  inlines.add('component', (_name, _params, hash, encoder, resolver, compiler, meta) => {
    assert(
      _params && _params.length,
      'SYNTAX ERROR: component helper requires at least one argument'
    );

    let tag = _params && _params[0];
    if (typeof tag === 'string') {
      let returned = staticComponentHelper(
        encoder,
        resolver,
        compiler,
        meta,
        tag as string,
        hash,
        null
      );
      if (returned) return true;
    }

    let [definition, ...params] = _params!;
    invokeDynamicComponent(encoder, resolver, compiler, meta, {
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
