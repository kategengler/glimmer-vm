import { CompileTimeConstants } from '../program';
import { Dict } from '../core';
import { BuilderOperands, Operands, BuilderOperand } from './operands';
import { Compiler, STDLib } from '../template';

export interface Labels<InstructionEncoder> {
  readonly labels: Dict<number>;
  readonly targets: Array<{ at: number; target: string }>;

  label(name: string, index: number): void;
  target(at: number, target: string): void;
  patch(encoder: InstructionEncoder): void;
}

/**
 * The Encoder receives a stream of opcodes from the syntax compiler and turns
 * them into a binary program.
 */
export interface Encoder<InstructionEncoder, Op extends number, MachineOp extends number> {
  isEager: boolean;

  readonly constants: CompileTimeConstants;
  readonly pos: number;
  readonly nextPos: number;
  readonly stdlib: STDLib;

  /**
   * Finalize the current compilation unit, add a `(Return)`, and push the opcodes from
   * the buffer into the program. At this point, some of the opcodes might still be
   * placeholders, such as in the case of recursively compiled templates.
   *
   * @param compiler
   * @param size
   */
  commit(
    compiler: Compiler<unknown, unknown, InstructionEncoder, Op, MachineOp>,
    size: number
  ): number;

  /**
   * Reserve space in the program for this opcode with one operand for the
   * target. This space will eventually be replaced with a target offset for
   * a jump, once labels have been resolved.
   *
   * @param opcode
   */
  reserve(opcode: Op): void;

  /**
   * Reserve space in the program for this opcode and a target, and one
   * additional operand.
   *
   * @param opcode
   * @param operand
   */
  reserveWithOperand(opcode: Op, operand: number): void;

  /**
   * Reserve space in the program for this machine opcode and a target.
   * It works the same way as `reserve` but inserts a machine opcode
   * instead of a syscall.
   *
   * @param opcode
   */
  reserveMachine(opcode: MachineOp): void;

  /**
   * Push a syscall into the program with up to three optional
   * operands.
   *
   * @param opcode
   * @param args up to three operands, formatted as
   *   { type: "type", value: value }
   */
  push(opcode: Op, ...args: BuilderOperands): void;

  /**
   * Push a machine opcode into the program with up to threee
   * optional operands.
   *
   * @param opcode
   * @param args
   */
  pushMachine(opcode: MachineOp, ...args: Operands): void;

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
  label(name: string, index: number): void;

  target(at: number, target: string): void;
  operand(operand: BuilderOperand): number;
}
