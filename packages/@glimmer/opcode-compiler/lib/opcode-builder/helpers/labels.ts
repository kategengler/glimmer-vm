import { OpcodeBuilderEncoder, Block } from '../interfaces';
import { Op, MachineOp } from '@glimmer/vm';

export function label(encoder: OpcodeBuilderEncoder, name: string) {
  encoder.currentLabels.label(name, encoder.nextPos);
}

export function labels(encoder: OpcodeBuilderEncoder, block: Block): void {
  encoder.startLabels();
  block(encoder);
  encoder.stopLabels();
}

export function reserveTarget(encoder: OpcodeBuilderEncoder, op: Op, target: string) {
  encoder.reserve(op);
  encoder.currentLabels.target(encoder.pos, target);
}

export function reserveTargetWithOperand(
  encoder: OpcodeBuilderEncoder,
  name: Op,
  operand: number,
  target: string
) {
  encoder.reserveWithOperand(name, operand);
  encoder.currentLabels.target(encoder.pos, target);
}

export function reserveMachineTarget(
  encoder: OpcodeBuilderEncoder,
  name: MachineOp,
  target: string
) {
  encoder.reserveMachine(name);
  encoder.currentLabels.target(encoder.pos, target);
}
