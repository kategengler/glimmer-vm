import { Dict, Option } from '../core';

type JsonValue = string | number | boolean | JsonObject | JsonArray;

interface JsonObject extends Dict<JsonValue> {}
interface JsonArray extends Array<JsonValue> {}

// This entire file is serialized to disk, so all strings
// end up being interned.
export type str = string;
export type TemplateReference = Option<SerializedBlock>;
export type YieldTo = number;

export const enum SexpOpcodes {
  // Statements
  Text = 0,
  Append = 1,
  Comment = 2,
  Modifier = 3,
  Block = 4,
  Component = 5,
  DynamicComponent = 6,
  OpenElement = 7,
  OpenSplattedElement = 8,
  FlushElement = 9,
  CloseElement = 10,
  StaticAttr = 11,
  DynamicAttr = 12,
  ComponentAttr = 13,
  AttrSplat = 14,
  Yield = 15,
  Partial = 16,

  DynamicArg = 17,
  StaticArg = 18,
  TrustingAttr = 19,
  TrustingComponentAttr = 20,
  Debugger = 21,
  ClientSideStatement = 22,

  // Expressions

  Unknown = 23,
  Get = 24,
  MaybeLocal = 25,
  HasBlock = 26,
  HasBlockParams = 27,
  Undefined = 28,
  Helper = 29,
  Concat = 30,
  ClientSideExpression = 31,
}

export namespace Core {
  export type Expression = Expressions.Expression;

  export type Path = str[];
  export type Params = Expression[];
  export type Hash = Option<[str[], Expression[]]>;
  export type Blocks = Option<[str[], SerializedInlineBlock[]]>;
  export type Args = [Params, Hash];
  export type EvalInfo = number[];
}

export namespace Expressions {
  export type Path = Core.Path;
  export type Params = Core.Params;
  export type Hash = Core.Hash;

  export type Unknown = [SexpOpcodes.Unknown, str];
  export type Get = [SexpOpcodes.Get, number, Path];

  /**
   * Ambiguous between a self lookup (when not inside an eval) and
   * a local variable (when used inside of an eval).
   */
  export type MaybeLocal = [SexpOpcodes.MaybeLocal, Path];

  export type Value = str | number | boolean | null;
  export type HasBlock = [SexpOpcodes.HasBlock, YieldTo];
  export type HasBlockParams = [SexpOpcodes.HasBlockParams, YieldTo];
  export type Undefined = [SexpOpcodes.Undefined];
  export type ClientSide = [SexpOpcodes.ClientSideExpression, any];

  export type TupleExpression =
    | Unknown
    | Get
    | MaybeLocal
    | Concat
    | HasBlock
    | HasBlockParams
    | Helper
    | Undefined
    | ClientSide;

  export type Expression = TupleExpression | Value;

  export interface Concat extends Array<any> {
    [0]: SexpOpcodes.Concat;
    [1]: Params;
  }

  export interface Helper extends Array<any> {
    [0]: SexpOpcodes.Helper;
    [1]: str;
    [2]: Params;
    [3]: Hash;
  }
}

export type Expression = Expressions.Expression;

export type TupleExpression = Expressions.TupleExpression;

export namespace Statements {
  export type Expression = Expressions.Expression;
  export type Params = Core.Params;
  export type Hash = Core.Hash;
  export type Blocks = Core.Blocks;
  export type Path = Core.Path;

  export type Text = [SexpOpcodes.Text, str];
  export type Append = [SexpOpcodes.Append, Expression, boolean];
  export type Comment = [SexpOpcodes.Comment, str];
  export type Modifier = [SexpOpcodes.Modifier, str, Params, Hash];
  export type Block = [SexpOpcodes.Block, str, Params, Hash, Blocks];
  export type Component = [SexpOpcodes.Component, str, Attribute[], Hash, Blocks];
  export type DynamicComponent = [
    SexpOpcodes.DynamicComponent,
    Expression,
    Attribute[],
    Hash,
    Blocks
  ];
  export type OpenElement = [SexpOpcodes.OpenElement, str];
  export type SplatElement = [SexpOpcodes.OpenSplattedElement, str];
  export type FlushElement = [SexpOpcodes.FlushElement];
  export type CloseElement = [SexpOpcodes.CloseElement];
  export type StaticAttr = [SexpOpcodes.StaticAttr, str, Expression, Option<str>];
  export type DynamicAttr = [SexpOpcodes.DynamicAttr, str, Expression, Option<str>];
  export type ComponentAttr = [SexpOpcodes.ComponentAttr, str, Expression, Option<str>];
  export type AttrSplat = [SexpOpcodes.AttrSplat, YieldTo];
  export type Yield = [SexpOpcodes.Yield, YieldTo, Option<Params>];
  export type Partial = [SexpOpcodes.Partial, Expression, Core.EvalInfo];
  export type DynamicArg = [SexpOpcodes.DynamicArg, str, Expression];
  export type StaticArg = [SexpOpcodes.StaticArg, str, Expression];
  export type TrustingAttr = [SexpOpcodes.TrustingAttr, str, Expression, str];
  export type TrustingComponentAttr = [SexpOpcodes.TrustingComponentAttr, str, Expression, str];
  export type Debugger = [SexpOpcodes.Debugger, Core.EvalInfo];
  export type ClientSide =
    | [SexpOpcodes.ClientSideStatement, any]
    | [SexpOpcodes.ClientSideStatement, any, any];

  /**
   * A Handlebars statement
   */
  export type Statement =
    | Text
    | Append
    | Comment
    | Modifier
    | Block
    | Component
    | DynamicComponent
    | OpenElement
    | SplatElement
    | FlushElement
    | CloseElement
    | StaticAttr
    | DynamicAttr
    | ComponentAttr
    | AttrSplat
    | Yield
    | Partial
    | StaticArg
    | DynamicArg
    | TrustingAttr
    | TrustingComponentAttr
    | Debugger
    | ClientSide;

  export type Attribute =
    | Statements.StaticAttr
    | Statements.DynamicAttr
    | Statements.ComponentAttr
    | Statements.TrustingComponentAttr
    | Statements.AttrSplat;

  export type Argument = Statements.StaticArg | Statements.DynamicArg;

  export type Parameter = Attribute | Argument;
}

/** A Handlebars statement */
export type Statement = Statements.Statement;
export type Attribute = Statements.Attribute;
export type Parameter = Statements.Parameter;

export type SexpSyntax = Statement | TupleExpression;
export type Syntax = SexpSyntax | Expressions.Value;

/**
 * A JSON object of static compile time meta for the template.
 */
export interface TemplateMeta {
  [key: string]: unknown;
  moduleName?: string;
}

/**
 * A JSON object that the Block was serialized into.
 */
export interface SerializedBlock {
  statements: Statements.Statement[];
}

export interface SerializedInlineBlock extends SerializedBlock {
  parameters: number[];
}

/**
 * A JSON object that the compiled TemplateBlock was serialized into.
 */
export interface SerializedTemplateBlock extends SerializedBlock {
  symbols: string[];
  hasEval: boolean;
}

/**
 * A JSON object that the compiled Template was serialized into.
 */
export interface SerializedTemplate<T extends TemplateMeta> {
  block: SerializedTemplateBlock;
  meta: T;
}

/**
 * A string of JSON containing a SerializedTemplateBlock
 */
export type SerializedTemplateBlockJSON = string;

/**
 * A JSON object containing the SerializedTemplateBlock as JSON and Locator.
 */
export interface SerializedTemplateWithLazyBlock<Locator> {
  id?: Option<string>;
  block: SerializedTemplateBlockJSON;
  meta: Locator;
}

/**
 * A string of Javascript containing a SerializedTemplateWithLazyBlock to be
 * concatenated into a Javascript module.
 */
export type TemplateJavascript = string;
