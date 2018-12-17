import { Option } from '@glimmer/interfaces';

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

export interface SerializableOperand {
  type: 'serializable';
  value: unknown;
}

export interface OtherOperand {
  type: 'other';
  value: unknown;
}

export type BuilderOperand =
  | OptionStringOperand
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

export type Operand = number | (() => number);

export type Operands = [] | [Operand] | [Operand, Operand] | [Operand, Operand, Operand];
