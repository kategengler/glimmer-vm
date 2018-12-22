import { Option } from '../core';
import * as WireFormat from './wire-format';
import { NamedBlocks } from '../template';
import {
  HighLevelCompileOp,
  HighLevelBuilderOp,
  HighLevelBuilderOpcode,
  BuilderOp,
  HighLevelCompileMap,
  HighLevelCompileOpcode,
  CompileActions,
} from './encoder';
import { OpcodeBuilder } from '@glimmer/opcode-compiler';

export const enum PrimitiveType {
  NUMBER = 0b000,
  FLOAT = 0b001,
  STRING = 0b010,
  // 0=false 1=true 2=null 3=undefined
  BOOLEAN_OR_VOID = 0b011,
  NEGATIVE = 0b100,
  BIG_NUM = 0b101,
}

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

export interface LookupHandleOperand {
  type: 'lookup';
  value: {
    kind: 'helper';
    value: string;
  };
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
  value: Option<CompileActions>;
}

export interface InlineBlockOperand {
  type: 'inline-block';
  value: HighLevelCompileMap[HighLevelCompileOpcode.InlineBlock];
}

export interface PrimitiveOperand {
  type: 'primitive';
  value: {
    type: PrimitiveType;
    primitive: SingleBuilderOperand;
  };
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
  | LookupHandleOperand
  | PrimitiveOperand
  | number;

export type SingleBuilderOperand = NonlabelBuilderOperand | LabelOperand | BuilderHandleThunk;
export type BuilderOperand = SingleBuilderOperand | HighLevelBuilderOp<HighLevelBuilderOpcode>;
export type CompileOperand = InlineBlockOperand;

export type SingleBuilderOperandsTuple =
  | []
  | [SingleBuilderOperand]
  | [SingleBuilderOperand, SingleBuilderOperand]
  | [SingleBuilderOperand, SingleBuilderOperand, SingleBuilderOperand];

export type BuilderOperandsTuple =
  | []
  | [BuilderOperand]
  | [BuilderOperand, BuilderOperand]
  | [BuilderOperand, BuilderOperand, BuilderOperand];

export type SingleBuilderOperands = SingleBuilderOperandsTuple & SingleBuilderOperand[];

export type BuilderHandleThunk = (() => number);

export type Operand = number | BuilderHandleThunk | StdlibOperand;

export type Operands = [] | [Operand] | [Operand, Operand] | [Operand, Operand, Operand];
