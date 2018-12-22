import {
  Option,
  Opaque,
  NamedBlocks as INamedBlocks,
  CompileTimeLookup,
  ContainingMetadata,
  SexpOpcodes,
  Op,
  MachineOp,
  BuilderOp,
  SexpOpcodeMap,
  HighLevelBuilderOpcode,
  CompileAction,
  HighLevelCompileOpcode,
  CompileActions,
  HighLevelCompileOp,
  HighLevelBuilderOp,
} from '@glimmer/interfaces';
import { assert, dict, unwrap, EMPTY_ARRAY } from '@glimmer/util';
import { $fp, $s0, $sp } from '@glimmer/vm';
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

import { WireFormat } from '@glimmer/interfaces';

import S = WireFormat.Statements;
import C = WireFormat.Core;
import { EMPTY_BLOCKS } from './utils';
import { resolveLayoutForTag } from './resolver';
import { expr, params } from './opcode-builder/helpers/shared';
import {
  yieldBlock,
  invokeStaticBlockWithStack,
  inlineBlock,
  templates,
  invokeStaticBlock,
} from './opcode-builder/helpers/blocks';
import {
  pushPrimitiveReference,
  hasBlockParams,
  frame,
  helper,
  list,
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
import { op } from './opcode-builder/encoder';

export type StatementCompileAction = CompileAction | HighLevelCompileOp;
export type StatementCompileActions = StatementCompileAction | StatementCompileAction[];

export type TupleSyntax =
  | WireFormat.Statement
  | WireFormat.TupleExpression
  | WireFormat.ClientSideStatement;
export type StatementCompilerFunction<T extends TupleSyntax, Locator> = ((
  sexp: T,
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>
) => StatementCompileActions | void);
export type SimpleCompilerFunction<T extends TupleSyntax, Locator> = ((
  sexp: T,
  state: ExprCompilerState<Locator>
) => CompileActions | void);
export type LeafCompilerFunction<T extends TupleSyntax, Locator> = ((
  sexp: T,
  meta: ContainingMetadata<Locator>,
  isEager: boolean
) => CompileActions | void);
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

  addSimple<T extends SexpOpcodes>(
    name: T,
    func: SimpleCompilerFunction<SexpOpcodeMap[T], Locator>
  ): void {
    this.funcs.push({
      type: 'mini',
      f: func as SimpleCompilerFunction<WireFormat.TupleExpression, Locator>,
    });
    this.names[name] = this.funcs.length - 1;
  }

  addLeaf<T extends SexpOpcodes>(
    name: T,
    func: LeafCompilerFunction<SexpOpcodeMap[T], Locator>
  ): void {
    this.funcs.push({
      type: 'leaf',
      f: func as LeafCompilerFunction<WireFormat.TupleExpression, Locator>,
    });
    this.names[name] = this.funcs.length - 1;
  }

  compile(
    sexp: WireFormat.TupleExpression,
    state: ExprCompilerState<Locator>
  ): CompileActions | void {
    let name: number = sexp![this.offset];
    let index = this.names[name];
    let func = this.funcs[index];
    assert(!!func, `expected an implementation for ${sexp[0]}`);

    if (func.type === 'mini') {
      return func.f(sexp, state);
    } else if (func.type === 'statement') {
      throw new Error(`Can't compile an expression as a statement`);
    } else {
      return func.f(sexp, state.meta, state.encoder.isEager);
    }
  }
}

function isCompileOp(
  action: BuilderOp | HighLevelBuilderOp | HighLevelCompileOp
): action is HighLevelCompileOp {
  return action.op === 'InlineBlock';
}

function concatStatement<Locator>(
  builder: OpcodeBuilder<Locator>,
  action: StatementCompileActions
): void {
  if (action === undefined) {
    return;
  } else if (Array.isArray(action)) {
    for (let item of action) {
      concatStatement(builder, item);
    }
  } else {
    if (isCompileOp(action)) {
      switch (action.op) {
        case HighLevelCompileOpcode.InlineBlock:
          inlineBlock(action.op1, builder.compiler, builder.resolver, builder.meta);
      }
    } else {
      concat(builder.encoder, action);
    }
  }
}

export function concat(encoder: OpcodeBuilderEncoder, action: CompileActions): void {
  if (action === undefined) {
    return;
  } else if (Array.isArray(action)) {
    action.forEach(a => concat(encoder, a));
  } else {
    encoder.pushOp(action);
  }
}

export function concatActions(
  left: ReadonlyArray<CompileAction>,
  right: CompileActions
): ReadonlyArray<CompileAction> {
  if (right === undefined) {
    return left;
  } else if (Array.isArray(right)) {
    return [...left, ...right];
  } else {
    return [...left, right];
  }
}

export class Compilers<Syntax extends TupleSyntax, Locator = unknown> {
  private names = dict<number>();
  private funcs: RegisteredSyntax<Syntax, Locator>[] = [];

  constructor() {}

  addStatement<T extends SexpOpcodes>(
    name: T,
    func: StatementCompilerFunction<SexpOpcodeMap[T], Locator>
  ): void {
    this.funcs.push({ type: 'statement', f: func });
    this.names[name] = this.funcs.length - 1;
  }

  addSimple<T extends SexpOpcodes>(
    name: T,
    func: SimpleCompilerFunction<SexpOpcodeMap[T], Locator>
  ): void {
    this.funcs.push({ type: 'mini', f: func });
    this.names[name] = this.funcs.length - 1;
  }

  addLeaf<T extends SexpOpcodes>(
    name: T,
    func: LeafCompilerFunction<SexpOpcodeMap[T], Locator>
  ): void {
    this.funcs.push({ type: 'leaf', f: func });
    this.names[name] = this.funcs.length - 1;
  }

  compileSimple<T extends SexpOpcodes>(
    sexp: SexpOpcodeMap[T],
    encoder: OpcodeBuilderEncoder,
    resolver: CompileTimeLookup<Locator>,
    compiler: OpcodeBuilderCompiler<Locator>,
    meta: ContainingMetadata<Locator>
  ): void {
    let name: number = sexp![0];
    let index = this.names[name];
    let func = this.funcs[index];
    assert(!!func, `expected an implementation for ${sexp![0]}`);

    let ops: CompileActions | void;
    if (func.type === 'mini') {
      ops = func.f(sexp as Syntax, { encoder, resolver, meta });
    } else if (func.type === 'statement') {
      let ops = func.f(sexp as Syntax, encoder, resolver, compiler, meta);
      concatStatement({ encoder, resolver, compiler, meta }, ops);
      return;
    } else {
      ops = func.f(sexp as Syntax, meta, encoder.isEager);
    }

    concat(encoder, ops);
  }

  compileStatement<T extends SexpOpcodes>(
    sexp: SexpOpcodeMap[T],
    builder: OpcodeBuilder<Locator>
  ): void {
    let name: number = sexp[0];
    let index = this.names[name];
    let func = this.funcs[index];
    assert(!!func, `expected an implementation for ${sexp[0]}`);

    let ops;
    if (func.type === 'leaf') {
      ops = func.f(sexp as Syntax, builder.meta, builder.encoder.isEager);
    } else if (func.type === 'statement') {
      ops = func.f(
        sexp as Syntax,
        builder.encoder,
        builder.resolver,
        builder.compiler,
        builder.meta
      );

      concatStatement(builder, ops);
      return;
    } else {
      ops = func.f(sexp as Syntax, builder);
    }

    concat(builder.encoder, ops);
  }

  compile(sexp: Syntax, builder: OpcodeBuilder<Locator>): void {
    let name: number = sexp[0];
    let index = this.names[name];
    let func = this.funcs[index];
    assert(!!func, `expected an implementation for ${sexp[0]}`);

    let ops;
    if (func.type === 'leaf') {
      ops = func.f(sexp, builder.meta, builder.encoder.isEager);
    } else if (func.type === 'statement') {
      ops = func.f(sexp, builder.encoder, builder.resolver, builder.compiler, builder.meta);
      concatStatement(builder, ops);
      return;
    } else {
      ops = func.f(sexp, builder);
    }

    concat(builder.encoder, ops);
  }
}

let _statementCompiler: Compilers<WireFormat.Statement, unknown>;

export function statementCompiler(): Compilers<WireFormat.Statement, unknown> {
  if (_statementCompiler) {
    return _statementCompiler;
  }

  const STATEMENTS = (_statementCompiler = new Compilers<WireFormat.Statement, unknown>());

  STATEMENTS.addLeaf(SexpOpcodes.Text, (sexp: S.Text) => {
    return op(Op.Text, str(sexp[1]));
  });

  STATEMENTS.addLeaf(SexpOpcodes.Comment, (sexp: S.Comment) => op(Op.Comment, str(sexp[1])));
  STATEMENTS.addLeaf(SexpOpcodes.CloseElement, () => op(Op.CloseElement));
  STATEMENTS.addLeaf(SexpOpcodes.FlushElement, () => op(Op.FlushElement));

  STATEMENTS.addSimple(SexpOpcodes.Modifier, (sexp, state) => {
    let { resolver, meta } = state;
    let [, name, params, hash] = sexp;

    let handle = resolver.lookupModifier(name, meta.referrer);

    if (handle !== null) {
      return modifier({ handle, params, hash });
    } else {
      throw new Error(
        `Compile Error ${name} is not a modifier: Helpers may not be used in the element form.`
      );
    }
  });

  STATEMENTS.addLeaf(SexpOpcodes.StaticAttr, ([, name, value, namespace]) =>
    staticAttr(name, namespace, value as string)
  );

  STATEMENTS.addSimple(SexpOpcodes.DynamicAttr, sexp => dynamicAttr(sexp, false));
  STATEMENTS.addSimple(SexpOpcodes.ComponentAttr, sexp => componentAttr(sexp, false));
  STATEMENTS.addSimple(SexpOpcodes.TrustingAttr, sexp => dynamicAttr(sexp, true));
  STATEMENTS.addSimple(SexpOpcodes.TrustingComponentAttr, sexp => componentAttr(sexp, true));

  STATEMENTS.addLeaf(SexpOpcodes.OpenElement, sexp => op(Op.OpenElement, str(sexp[1])));

  STATEMENTS.addLeaf(SexpOpcodes.OpenSplattedElement, sexp => [
    op(Op.PutComponentOperations),
    op(Op.OpenElement, str(sexp[1])),
  ]);

  STATEMENTS.addStatement(
    SexpOpcodes.DynamicComponent,
    (sexp, encoder, resolver, compiler, meta) => {
      let [, definition, attrs, args, blocks] = sexp;

      let attrsBlock = null;
      if (attrs.length > 0) {
        let wrappedAttrs: WireFormat.Statement[] = [...attrs];

        attrsBlock = inlineBlock(
          { statements: wrappedAttrs, parameters: EMPTY_ARRAY },
          compiler,
          resolver,
          meta
        );
      }

      invokeDynamicComponent(encoder, resolver, compiler, meta, {
        definition,
        attrs: attrsBlock,
        params: null,
        hash: args,
        synthetic: false,
        blocks: templates(blocks, compiler, resolver, meta),
      });
    }
  );

  STATEMENTS.addStatement(SexpOpcodes.Component, (sexp, encoder, resolver, compiler, meta) => {
    let [, tag, _attrs, args, blocks] = sexp;
    let { referrer } = meta;

    let { handle: layoutHandle, capabilities, compilable } = resolveLayoutForTag(
      tag,
      resolver,
      referrer
    );

    if (layoutHandle !== null && capabilities !== null) {
      let attrs: WireFormat.Statement[] = [..._attrs];
      let attrsBlock = inlineBlock(
        { statements: attrs, parameters: EMPTY_ARRAY },
        compiler,
        resolver,
        meta
      );

      if (compilable) {
        encoder.push(Op.PushComponentDefinition, handle(layoutHandle));
        invokeStaticComponent(encoder, resolver, compiler, meta, {
          capabilities,
          layout: compilable,
          attrs: attrsBlock,
          params: null,
          hash: args,
          synthetic: false,
          blocks: templates(blocks, compiler, resolver, meta),
        });
      } else {
        encoder.push(Op.PushComponentDefinition, handle(layoutHandle));
        invokeComponent(encoder, resolver, compiler, meta, {
          capabilities,
          attrs: attrsBlock,
          params: null,
          hash: args,
          synthetic: false,
          blocks: templates(blocks, compiler, resolver, meta),
        });
      }
    } else {
      throw new Error(`Compile Error: Cannot find component ${tag}`);
    }
  });

  STATEMENTS.addSimple(SexpOpcodes.Partial, (sexp, state) => {
    let [, name, evalInfo] = sexp;

    let { encoder, meta } = state;

    replayableIf(encoder, {
      args() {
        state.encoder.concat(expr(name, state));
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

  STATEMENTS.addStatement(SexpOpcodes.Yield, (sexp, encoder) => {
    let [, to, params] = sexp;

    return yieldBlock(to, params, encoder.isEager);
  });

  STATEMENTS.addStatement(SexpOpcodes.AttrSplat, (sexp, encoder) => {
    let [, to] = sexp;

    return yieldBlock(to, EMPTY_ARRAY, encoder.isEager);
  });

  STATEMENTS.addLeaf(SexpOpcodes.Debugger, ([, evalInfo], meta) =>
    op(Op.Debugger, strArray(meta.evalSymbols!), arr(evalInfo))
  );

  STATEMENTS.addStatement(SexpOpcodes.Append, (sexp, encoder, resolver, compiler, meta) => {
    let [, value, trusting] = sexp;

    let returned = compiler.compileInline(sexp, encoder, resolver, meta) || value;

    if (returned === true) return;

    encoder.concat(guardedAppend(value, trusting));
  });

  STATEMENTS.addStatement(SexpOpcodes.Block, (sexp, encoder, resolver, compiler, meta) => {
    let [, name, params, hash, named] = sexp;

    compiler.compileBlock(
      name,
      params,
      hash,
      templates(named, compiler, resolver, meta),
      encoder,
      resolver,
      compiler,
      meta
    );
  });

  STATEMENTS.addLeaf(SexpOpcodes.ClientOpenComponentElement, ([, tag]) => [
    op(Op.PutComponentOperations),
    op(Op.OpenElement, str(tag)),
  ]);

  STATEMENTS.addLeaf(SexpOpcodes.ClientDidCreateElement, () => op(Op.DidCreateElement, $s0));

  STATEMENTS.addLeaf(SexpOpcodes.ClientDebugger, () => {
    // tslint:disable-next-line:no-debugger
    debugger;
  });

  STATEMENTS.addLeaf(SexpOpcodes.ClientDidRenderLayout, () => op(Op.DidRenderLayout, $s0));

  return STATEMENTS;
}

function dynamicAttr(sexp: S.DynamicAttr | S.TrustingAttr, trusting: boolean): CompileActions {
  let [, name, value, namespace] = sexp;

  return [
    op(HighLevelBuilderOpcode.Expr, value),
    op(Op.DynamicAttr, str(name), bool(trusting), optionStr(namespace)),
  ];
  // expr(value, state);

  // if (namespace) {
  //   finishDynamicAttr(name, namespace, trusting);
  // } else {
  //   finishDynamicAttr(name, null, trusting);
  // }
}

export function finishDynamicAttr(
  name: string,
  namespace: Option<string>,
  trusting: boolean
): CompileAction {
  return op(Op.DynamicAttr, str(name), bool(trusting), optionStr(namespace));
}

function componentAttr(sexp: S.ComponentAttr | S.TrustingComponentAttr, trusting: boolean) {
  let [, name, value, namespace] = sexp;

  return [
    op(HighLevelBuilderOpcode.Expr, value),
    op(Op.ComponentAttr, str(name), bool(trusting), optionStr(namespace)),
  ];
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
): CompileActions | void {
  return expressionCompiler().compile(expression, state);
}

let _expressionCompiler: ExpressionCompilers<unknown>;

export function expressionCompiler(): ExpressionCompilers<unknown> {
  if (_expressionCompiler) {
    return _expressionCompiler;
  }

  const EXPRESSIONS = (_expressionCompiler = new ExpressionCompilers());

  EXPRESSIONS.addSimple(SexpOpcodes.Unknown, (sexp, state) => {
    let name = sexp[1];

    let out: ReadonlyArray<CompileAction> = [];

    let { resolver, meta } = state;

    let handle = resolver.lookupHelper(name, meta.referrer);

    if (handle !== null) {
      out = concatActions(out, helper({ handle, params: null, hash: null }));
    } else if (meta.asPartial) {
      out = concatActions(out, op(Op.ResolveMaybeLocal, str(name)));
    } else {
      out = concatActions(out, [op(Op.GetVariable, 0), op(Op.GetProperty, str(name))]);
    }

    return out as CompileAction[];
  });

  EXPRESSIONS.addSimple(SexpOpcodes.Concat, ([, parts], state) => {
    let out: ReadonlyArray<CompileAction> = [];

    for (let part of parts) {
      out = concatActions(out, expr(part, state));
    }

    return [...out, op(Op.Concat, parts.length)];
  });

  EXPRESSIONS.addSimple(SexpOpcodes.Helper, (sexp, state) => {
    let [, name, params, hash] = sexp;

    let { resolver, meta } = state;

    let out: ReadonlyArray<CompileAction> = [];

    // TODO: triage this in the WF compiler
    if (name === 'component') {
      assert(params.length, 'SYNTAX ERROR: component helper requires at least one argument');

      let [definition, ...restArgs] = params;
      return concatActions(
        out,
        curryComponent(
          {
            definition,
            params: restArgs,
            hash,
            synthetic: true,
          },
          state.meta.referrer
        )
      ) as CompileActions;
    }

    let handle = resolver.lookupHelper(name, meta.referrer);

    if (handle !== null) {
      out = concatActions(out, helper({ handle, params, hash }));
    } else {
      throw new Error(`Compile Error: ${name} is not a helper`);
    }

    return out as CompileActions;
  });

  EXPRESSIONS.addLeaf(SexpOpcodes.Get, ([, head, path]) => [
    op(Op.GetVariable, head),
    ...path.map(p => op(Op.GetProperty, str(p))),
  ]);

  EXPRESSIONS.addLeaf(SexpOpcodes.MaybeLocal, (sexp, meta) => {
    let [, path] = sexp;

    let out: CompileAction[] = [];

    if (meta.asPartial) {
      let head = path[0];
      path = path.slice(1);

      out.push(op(Op.ResolveMaybeLocal, str(head)));
    } else {
      out.push(op(Op.GetVariable, 0));
    }

    for (let i = 0; i < path.length; i++) {
      out.push(op(Op.GetProperty, str(path[i])));
    }

    return out;
  });

  EXPRESSIONS.addLeaf(SexpOpcodes.Undefined, () => {
    return pushPrimitiveReference(undefined);
  });

  EXPRESSIONS.addLeaf(SexpOpcodes.HasBlock, sexp => {
    return op(Op.HasBlock, sexp[1]);
  });

  EXPRESSIONS.addLeaf(SexpOpcodes.HasBlockParams, (sexp, _meta, isEager) => {
    return hasBlockParams(sexp[1], isEager);
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

    if (value[0] === SexpOpcodes.Helper) {
      name = value[1];
      params = value[2];
      hash = value[3];
    } else if (value[0] === SexpOpcodes.Unknown) {
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
  blocks.add('if', (params, _hash, blocks, encoder, resolver, _compiler, meta) => {
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
        encoder.concat(expr(params[0], { encoder, resolver, meta }));
        encoder.push(Op.ToBoolean);
        return 1;
      },

      ifTrue() {
        encoder.concat(invokeStaticBlock(unwrap(blocks.get('default')), encoder.isEager));
      },

      ifFalse() {
        if (blocks.has('else')) {
          encoder.concat(invokeStaticBlock(blocks.get('else')!, encoder.isEager));
        }
      },
    });
  });

  blocks.add('unless', (params, _hash, blocks, encoder, resolver, _compiler, meta) => {
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
        encoder.concat(expr(params[0], { encoder, resolver, meta }));
        encoder.push(Op.ToBoolean);
        return 1;
      },

      ifTrue() {
        if (blocks.has('else')) {
          encoder.concat(invokeStaticBlock(blocks.get('else')!, encoder.isEager));
        }
      },

      ifFalse() {
        encoder.concat(invokeStaticBlock(unwrap(blocks.get('default')), encoder.isEager));
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
        encoder.concat(expr(params[0], { encoder, resolver, meta }));
        encoder.push(Op.Dup, $sp, 0);
        encoder.push(Op.ToBoolean);
        return 2;
      },

      ifTrue() {
        invokeStaticBlockWithStack(encoder, compiler, unwrap(blocks.get('default')), 1);
      },

      ifFalse() {
        if (blocks.has('else')) {
          encoder.concat(invokeStaticBlock(blocks.get('else')!, encoder.isEager));
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
          encoder.concat(expr(hash[1][0], { encoder, resolver, meta }));
        } else {
          encoder.concat(pushPrimitiveReference(null));
        }

        encoder.concat(expr(params[0], { encoder, resolver, meta }));

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
            invokeStaticBlockWithStack(encoder, compiler, unwrap(blocks.get('default')), 2);
            encoder.push(Op.Pop, 2);
            encoder.push(MachineOp.Jump, label('FINALLY'));

            encoder.label('BREAK');
          });
        });

        encoder.push(MachineOp.Jump, label('FINALLY'));
        encoder.label('ELSE');

        if (blocks.has('else')) {
          encoder.concat(invokeStaticBlock(blocks.get('else')!, encoder.isEager));
        }
      },
    });
  });

  blocks.add('in-element', (params, hash, blocks, encoder, resolver, _compiler, meta) => {
    if (!params || params.length !== 1) {
      throw new Error(`SYNTAX ERROR: #in-element requires a single argument`);
    }

    replayableIf(encoder, {
      args() {
        let [keys, values] = hash!;

        for (let i = 0; i < keys.length; i++) {
          let key = keys[i];
          if (key === 'nextSibling' || key === 'guid') {
            encoder.concat(expr(values[i], { encoder, resolver, meta }));
          } else {
            throw new Error(`SYNTAX ERROR: #in-element does not take a \`${keys[0]}\` option`);
          }
        }

        encoder.concat(expr(params[0], { encoder, resolver, meta }));

        encoder.push(Op.Dup, $sp, 0);

        return 4;
      },

      ifTrue() {
        remoteElement(encoder, () =>
          encoder.concat(invokeStaticBlock(unwrap(blocks.get('default')), encoder.isEager))
        );
      },
    });
  });

  blocks.add('-with-dynamic-vars', (_params, hash, blocks, encoder, resolver, _compiler, meta) => {
    if (hash) {
      let [names, expressions] = hash;

      params(expressions, { encoder, resolver, meta });

      dynamicScope(encoder, names, () => {
        encoder.concat(invokeStaticBlock(unwrap(blocks.get('default')), encoder.isEager));
      });
    } else {
      encoder.concat(invokeStaticBlock(unwrap(blocks.get('default')), encoder.isEager));
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
