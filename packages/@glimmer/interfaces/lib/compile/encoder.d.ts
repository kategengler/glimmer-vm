import { CompileTimeConstants, CompileTimeHeap } from '../program';
import { Dict, Option } from '../core';
import {
  Operands,
  BuilderOperand,
  SingleBuilderOperand,
  BuilderHandleThunk,
  SingleBuilderOperands,
} from './operands';
import { STDLib, ContainingMetadata, NamedBlocks } from '../template';
import { CompileTimeLookup } from '../serialize';
import { Op, MachineOp } from '../vm-opcodes';
import { WireFormat } from '@glimmer/interfaces';

export interface Labels<InstructionEncoder> {
  readonly labels: Dict<number>;
  readonly targets: Array<{ at: number; target: string }>;

  label(name: string, index: number): void;
  target(at: number, target: string): void;
  patch(encoder: InstructionEncoder): void;
}

export const enum HighLevelBuilderOpcode {
  Expr = 'Expr',
  Args = 'Args',
  Option = 'Option',
}

export interface HighLevelBuilderMap {
  [HighLevelBuilderOpcode.Expr]: WireFormat.Expression;
  [HighLevelBuilderOpcode.Args]: {
    params: Option<WireFormat.Core.Params>;
    hash: WireFormat.Core.Hash;
    blocks: NamedBlocks;
    synthetic: boolean;
  };
  [HighLevelBuilderOpcode.Option]: Option<BuilderOp[]>;
}

export type HighLevelOperand = HighLevelBuilderMap[keyof HighLevelBuilderMap];

export const enum HighLevelCompileOpcode {
  InlineBlock = 'InlineBlock',
}

export interface HighLevelCompileMap {
  [HighLevelCompileOpcode.InlineBlock]: WireFormat.SerializedInlineBlock;
}

export type BuilderOpcode = Op | MachineOp;

/**
 * Vocabulary (in progress)
 *
 * Op: An entire operation (composed of an Opcode and 0-3 operands)
 * Opcode: The name of the operation
 * Operand: An operand passed to the operation
 */

export interface BuilderOp {
  op: BuilderOpcode;
  op1?: SingleBuilderOperand | BuilderHandleThunk;
  op2?: SingleBuilderOperand | BuilderHandleThunk;
  op3?: SingleBuilderOperand | BuilderHandleThunk;
}

export interface HighLevelBuilderOp<T extends HighLevelBuilderOpcode = HighLevelBuilderOpcode> {
  op: T;
  op1: HighLevelBuilderMap[T];
}

export interface HighLevelCompileOp<T extends HighLevelCompileOpcode = HighLevelCompileOpcode> {
  op: T;
  op1: HighLevelCompileMap[T];
}

export type CompileAction = void | undefined | BuilderOp | HighLevelBuilderOp;
export type CompileActions = CompileAction | CompileAction[];

/**
 * The Encoder receives a stream of opcodes from the syntax compiler and turns
 * them into a binary program.
 */
export interface Encoder<InstructionEncoder> {
  isEager: boolean;

  /**
   * Finalize the current compilation unit, add a `(Return)`, and push the opcodes from
   * the buffer into the program. At this point, some of the opcodes might still be
   * placeholders, such as in the case of recursively compiled templates.
   *
   * @param compiler
   * @param size
   */
  commit(heap: CompileTimeHeap): number;

  /**
   * Push a syscall into the program with up to three optional
   * operands.
   *
   * @param opcode
   * @param args up to three operands, formatted as
   *   { type: "type", value: value }
   */
  push(opcode: BuilderOpcode, ...args: SingleBuilderOperands): void;

  pushOp<T extends HighLevelBuilderOpcode>(opcode: BuilderOp | HighLevelBuilderOp<T>): void;

  concat(opcodes: CompileActions): void;

  /**
   * Start a new labels block. A labels block is a scope for labels that
   * can be referred to before they are declared. For example, when compiling
   * an `if`, the `JumpUnless` opcode occurs before the target label. To
   * accomodate this use-case ergonomically, the `Encoder` allows a syntax
   * to create a labels block and then refer to labels that have not yet
   * been declared. Once the block is complete, a second pass replaces the
   * label names with offsets.
   *
   * The pattern is:
   *
   * ```ts
   * encoder.reserve(Op.JumpUnless);
   * encoder.target(encoder.pos, 'ELSE');
   * ```
   *
   * The `reserve` method creates a placeholder opcode with space for a target
   * in the future, and the `target` method registers the blank operand position
   * to be replaced with an offset to `ELSE`, once it's known.
   */
  startLabels(): void;

  /**
   * Finish the current labels block and replace label names with offsets,
   * now that all of the offsets are known.
   */
  stopLabels(): void;

  /**
   * Mark the current position with a label name. This label name
   * can be used by any other opcode in this label block.
   * @param name
   * @param index
   */
  label(name: string): void;

  operand(operand: BuilderOperand): number;
}

export interface ExprCompilerState<
  Locator,
  InstructionEncoder,
  Op extends number,
  MachineOp extends number
> {
  encoder: Encoder<InstructionEncoder>;
  resolver: CompileTimeLookup<Locator>;
  meta: ContainingMetadata<Locator>;
}
