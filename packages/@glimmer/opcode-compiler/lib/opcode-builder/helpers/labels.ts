import { OpcodeBuilderEncoder, Block } from '../interfaces';
import { MachineOp } from '@glimmer/vm';

export function markLabel(encoder: OpcodeBuilderEncoder, name: string) {
  encoder.label(name, encoder.nextPos);
}

export function labels(encoder: OpcodeBuilderEncoder, block: Block): void {
  encoder.startLabels();
  block(encoder);
  encoder.stopLabels();
}

export function reserveMachineTarget(
  encoder: OpcodeBuilderEncoder,
  name: MachineOp,
  target: string
) {
  encoder.reserveMachine(name);
  encoder.target(encoder.pos, target);
}
