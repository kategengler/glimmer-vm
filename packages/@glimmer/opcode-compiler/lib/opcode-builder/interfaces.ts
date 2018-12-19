import {
  Compiler,
  LayoutWithContext,
  VMHandle,
  Option,
  CompilableBlock,
  NamedBlocks,
  ComponentCapabilities,
  CompilableProgram,
  CompileTimeLookup,
  ContainingMetadata,
  Encoder,
  HandleOperand,
  StringArrayOperand,
  ArrayOperand,
  NumberOperand,
  BooleanOperand,
  StringOperand,
  SerializableOperand,
  OtherOperand,
  OptionStringOperand,
  LabelOperand,
} from '@glimmer/interfaces';
import * as WireFormat from '@glimmer/wire-format';

import { Op, MachineOp } from '@glimmer/vm';
import { Core } from '@glimmer/wire-format';
import { InstructionEncoder } from '@glimmer/encoder';

export type Label = string;

export type When = (match: number, callback: () => void) => void;

export interface OpcodeBuilderConstructor<Locator> {
  new (
    compiler: OpcodeBuilderCompiler<Locator>,
    containingLayout: LayoutWithContext
  ): OpcodeBuilder<Locator>;
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

export type Block = (encoder: OpcodeBuilderEncoder) => void;

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

export function str(value: string): StringOperand {
  return { type: 'string', value };
}

export function optionStr(value: Option<string>): OptionStringOperand {
  return { type: 'option-string', value };
}

export function bool(value: boolean): BooleanOperand {
  return { type: 'boolean', value };
}

export function num(value: number): NumberOperand {
  return { type: 'number', value };
}

export function arr(value: number[]): ArrayOperand {
  return {
    type: 'array',
    value,
  };
}

export function strArray(value: string[]): StringArrayOperand {
  return {
    type: 'string-array',
    value,
  };
}

export function handle(value: number): HandleOperand {
  return { type: 'handle', value };
}

export function serializable(value: unknown): SerializableOperand {
  return { type: 'serializable', value };
}

export function other(value: unknown): OtherOperand {
  return { type: 'other', value };
}

export function label(value: string): LabelOperand {
  return { type: 'label', value };
}

export type Operand = number | (() => number);

export type Operands = [] | [Operand] | [Operand, Operand] | [Operand, Operand, Operand];

export type OpcodeBuilderCompiler<Locator> = Compiler<
  OpcodeBuilder<Locator>,
  Locator,
  InstructionEncoder,
  Op,
  MachineOp
>;

export type OpcodeBuilderEncoder = Encoder<InstructionEncoder, Op, MachineOp>;

export default interface OpcodeBuilder<Locator = unknown> {
  readonly resolver: CompileTimeLookup<Locator>;
  readonly compiler: OpcodeBuilderCompiler<Locator>;
  readonly encoder: OpcodeBuilderEncoder;
  readonly meta: ContainingMetadata<Locator>;
}
