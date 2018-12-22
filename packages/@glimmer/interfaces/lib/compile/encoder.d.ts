import { CompileTimeConstants, CompileTimeHeap } from '../program';
import { Dict } from '../core';
import { BuilderOperands, Operands, BuilderOperand, MachineBuilderOperand } from './operands';
import { STDLib, ContainingMetadata } from '../template';
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

export const enum HighLevelBuilderOp {
  Expr = 'Expr',
  Args = 'Args',
  Option = 'Option',
}

export const enum HighLevelCompileOp {
  InlineBlock = 'InlineBlock',
}

export interface HighLevelCompileOpMap {
  [HighLevelCompileOp.InlineBlock]: [WireFormat.SerializedInlineBlock];
}

export type BuilderOpcode = Op | MachineOp | HighLevelBuilderOp;

export interface BuilderOp {
  op: BuilderOpcode;
  op1?: MachineBuilderOperand;
  op2?: MachineBuilderOperand;
  op3?: MachineBuilderOperand;
}

export type CompileOps = {
  [P in keyof HighLevelCompileOpMap]: { op: P; op1: HighLevelCompileOpMap[P] }
};

export type CompileOp = CompileOps[keyof CompileOps];
export type BuilderOps = (BuilderOp | undefined)[];
export type CompileAction = void | undefined | BuilderOps | BuilderOp;

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
  push(opcode: Op | MachineOp, ...args: BuilderOperands): void;

  pushOp(opcode: BuilderOp): void;

  concat(opcodes: CompileAction): void;

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
