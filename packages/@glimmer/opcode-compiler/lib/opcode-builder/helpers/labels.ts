import { OpcodeBuilderEncoder, Block } from '../interfaces';

export function labels(encoder: OpcodeBuilderEncoder, block: Block): void {
  encoder.startLabels();
  block(encoder);
  encoder.stopLabels();
}
