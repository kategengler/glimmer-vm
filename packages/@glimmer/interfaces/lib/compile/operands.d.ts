import { Option } from '../core';
import * as WireFormat from './wire-format';
import { NamedBlocks } from '../template';
import { BuilderOps } from './encoder';

export interface OptionStringOperand {
  readonly type: 'option-string';
  readonly value: Option<string>;
}

export interface StringOperand {
  readonly type: 'string';
  readonly value: string;
}

export interface BooleanOperand {
  type: 'boolean';
  value: boolean;
}

// For numbers that don't fit inside the operand size
export interface NumberOperand {
  type: 'number';
  value: number;
}

export interface ArrayOperand {
  type: 'array';
  value: number[];
}

export interface StringArrayOperand {
  type: 'string-array';
  value: string[];
}

export interface HandleOperand {
  type: 'handle';
  value: number;
}

export interface LabelOperand {
  type: 'label';
  value: string;
}

export interface SerializableOperand {
  type: 'serializable';
  value: unknown;
}

export interface OtherOperand {
  type: 'other';
  value: unknown;
}

export interface StdlibOperand {
  type: 'stdlib';
  value: 'main' | 'trusting-append' | 'cautious-append';
}

// TODO: Derive these as well as the shape of valid op() calls from the
// operand list and high level extensions
export interface ExpressionOperand {
  type: 'expr';
  value: WireFormat.Expression;
}

export interface ArgsOptions {
  params: Option<WireFormat.Core.Params>;
  hash: WireFormat.Core.Hash;
  blocks: NamedBlocks;
  synthetic: boolean;
}

export interface ArgsOperand {
  type: 'args';
  value: ArgsOptions;
}

export interface OptionOperand {
  type: 'option';
  value: Option<BuilderOps>;
}

export type NonlabelBuilderOperand =
  | OptionStringOperand
  | StringOperand
  | BooleanOperand
  | NumberOperand
  | ArrayOperand
  | StringArrayOperand
  | HandleOperand
  | LabelOperand
  | SerializableOperand
  | OtherOperand
  | StdlibOperand
  | number;

export type HighLevelOperand = ExpressionOperand | ArgsOperand | OptionOperand;
export type BuilderOperand = NonlabelBuilderOperand | LabelOperand | HighLevelOperand;
export type MachineBuilderOperand = BuilderOperand | BuilderHandleThunk;

export type BuilderOperandsTuple =
  | []
  | [BuilderOperand]
  | [BuilderOperand, BuilderOperand]
  | [BuilderOperand, BuilderOperand, BuilderOperand];

export type MachineBuilderOperandsTuple =
  | []
  | [MachineBuilderOperand]
  | [MachineBuilderOperand, MachineBuilderOperand]
  | [MachineBuilderOperand, MachineBuilderOperand, MachineBuilderOperand];

export type BuilderOperands = MachineBuilderOperandsTuple & MachineBuilderOperand[];

export type BuilderHandleThunk = (() => number);

export type Operand = number | BuilderHandleThunk | StdlibOperand;

export type Operands = [] | [Operand] | [Operand, Operand] | [Operand, Operand, Operand];
