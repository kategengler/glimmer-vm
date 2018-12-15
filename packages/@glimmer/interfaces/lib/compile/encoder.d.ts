import { CompileTimeConstants } from '../program';
import { Dict } from '../core';
import { BuilderOperands, Operands, BuilderOperand } from './operands';

export interface Labels<InstructionEncoder> {
  readonly labels: Dict<number>;
  readonly targets: Array<{ at: number; target: string }>;

  label(name: string, index: number): void;
  target(at: number, target: string): void;
  patch(encoder: InstructionEncoder): void;
}

export interface Encoder<InstructionEncoder, Op extends number, MachineOp extends number> {
  isComponentAttrs: boolean;
  readonly constants: CompileTimeConstants;
  readonly pos: number;
  readonly nextPos: number;

  currentLabels: Labels<InstructionEncoder>;

  reserve(name: Op): void;
  reserveWithOperand(name: Op, operand: number): void;
  reserveMachine(name: MachineOp): void;

  push(name: Op, ...args: BuilderOperands): void;
  pushMachine(name: MachineOp, ...args: Operands): void;
  operand(operand: BuilderOperand): number;

  startLabels(): void;
  stopLabels(): void;
}
