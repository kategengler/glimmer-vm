import {
  Compiler,
  LayoutWithContext,
  VMHandle,
  Option,
  CompilableBlock,
  NamedBlocks,
  ComponentCapabilities,
  CompilableProgram,
  STDLib,
  CompilationResolver,
  ContainingMetadata,
} from '@glimmer/interfaces';
import * as WireFormat from '@glimmer/wire-format';

import { ComponentArgs, ComponentBuilder } from '../interfaces';
import { SavedRegister, Op, MachineOp } from '@glimmer/vm';
import { SerializedInlineBlock, Statements, Core, Expression } from '@glimmer/wire-format';
import { Operand } from '@glimmer/encoder';
import { Encoder } from './encoder';

export type Label = string;

export type When = (match: number, callback: () => void) => void;

export interface OpcodeBuilderConstructor<Locator> {
  new (compiler: Compiler, containingLayout: LayoutWithContext): OpcodeBuilder<Locator>;
}

export type VMHandlePlaceholder = [number, () => VMHandle];

export interface ReplayableIf {
  args(): number;
  ifTrue(): void;
  ifFalse?(): void;
}

export interface Replayable {
  args(): number;
  body(): void;
}

export type Block = (encoder: Encoder) => void;

export interface DynamicComponent {
  definition: WireFormat.Expression;
  attrs: Option<CompilableBlock>;
  params: Option<WireFormat.Core.Params>;
  hash: WireFormat.Core.Hash;
  synthetic: boolean;
  blocks: NamedBlocks;
}

export interface StaticComponent {
  capabilities: ComponentCapabilities;
  layout: CompilableProgram;
  attrs: Option<CompilableBlock>;
  params: Option<WireFormat.Core.Params>;
  hash: WireFormat.Core.Hash;
  synthetic: boolean;
  blocks: NamedBlocks;
}

export interface Component {
  capabilities: ComponentCapabilities | true;
  attrs: Option<CompilableBlock>;
  params: Option<WireFormat.Core.Params>;
  hash: WireFormat.Core.Hash;
  synthetic: boolean;
  blocks: NamedBlocks;
  layout?: CompilableProgram;
}

export interface CurryComponent {
  definition: WireFormat.Expression;
  params: Option<WireFormat.Core.Params>;
  hash: WireFormat.Core.Hash;
  synthetic: boolean;
}

export interface CompileBlock {
  name: string;
  params: Core.Params;
  hash: Core.Hash;
  blocks: NamedBlocks;
}

export interface CompileHelper {
  handle: number;
  params: Option<Core.Params>;
  hash: Core.Hash;
}

export interface StringOperand {
  readonly type: 'string';
  readonly value: string;
}

export function str(value: string): StringOperand {
  return { type: 'string', value };
}

export interface BooleanOperand {
  type: 'boolean';
  value: boolean;
}

export function bool(value: boolean): BooleanOperand {
  return { type: 'boolean', value };
}

// For numbers that don't fit inside the operand size
export interface NumberOperand {
  type: 'number';
  value: number;
}

export function num(value: number): NumberOperand {
  return { type: 'number', value };
}

export interface ArrayOperand {
  type: 'array';
  value: number[];
}

export function arr(value: number[]): ArrayOperand {
  return {
    type: 'array',
    value,
  };
}

export interface StringArrayOperand {
  type: 'string-array';
  value: string[];
}

export function strArray(value: string[]): StringArrayOperand {
  return {
    type: 'string-array',
    value,
  };
}

export interface HandleOperand {
  type: 'handle';
  value: number;
}

export interface SerializableOperand {
  type: 'serializable';
  value: unknown;
}

export function serializable(value: unknown): SerializableOperand {
  return { type: 'serializable', value };
}

export interface OtherOperand {
  type: 'other';
  value: unknown;
}

export type BuilderOperand =
  | StringOperand
  | BooleanOperand
  | NumberOperand
  | ArrayOperand
  | StringArrayOperand
  | HandleOperand
  | SerializableOperand
  | OtherOperand
  | number;

export type BuilderOperands =
  | []
  | [BuilderOperand]
  | [BuilderOperand, BuilderOperand]
  | [BuilderOperand, BuilderOperand, BuilderOperand];

export type Operands = [] | [Operand] | [Operand, Operand] | [Operand, Operand, Operand];

export default interface OpcodeBuilder<Locator = unknown> {
  readonly resolver: CompilationResolver<Locator>;
  readonly component: ComponentBuilder;
  readonly compiler: Compiler<this, Locator>;
  readonly encoder: Encoder;
  readonly meta: ContainingMetadata<Locator>;
  readonly stdLib: STDLib;

  push(name: Op, ...args: BuilderOperands): void;
  pushMachine(name: MachineOp, ...args: Operands): void;

  frame(options: Block): void;

  toBoolean(): void;

  pop(count?: number): void;

  withSavedRegister(register: SavedRegister, block: Block): void;

  iterate(label: string): void;

  jump(label: string): void;

  dynamicAttr(name: string, namespace: Option<string>, trusting: boolean): void;

  bindDynamicScope(names: string[]): void;

  staticComponentHelper(
    tag: string,
    hash: WireFormat.Core.Hash,
    template: Option<CompilableBlock>
  ): boolean;

  wrappedComponent(layout: LayoutWithContext<Locator>, attrsBlockNumber: number): number;
  staticComponent(handle: number, args: ComponentArgs): void;

  // TODO: These don't seem like the right abstraction, but leaving
  // them for now in the interest of expedience.
  commit(): number;
  templates(blocks: Core.Blocks): NamedBlocks;
  inlineBlock(block: SerializedInlineBlock): CompilableBlock;
  compileInline(sexp: Statements.Append): ['expr', Expression] | true;
  compileBlock(block: CompileBlock): void;
}
