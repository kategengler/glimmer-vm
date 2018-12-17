import { InstructionEncoder, OpcodeSize } from '@glimmer/encoder';
import {
  CompileTimeConstants,
  Encoder,
  Labels,
  STDLib,
  BuilderOperands,
  LabelOperand,
  MachineBuilderOperand,
  BuilderHandleThunk,
  Operand,
} from '@glimmer/interfaces';
import { OpcodeBuilderCompiler } from './interfaces';
import { MachineOp, Op, isMachineOp } from '@glimmer/vm';
import { LazyConstants } from '@glimmer/program';
import { Stack, dict, expect } from '@glimmer/util';

export type OpcodeBuilderLabels = Labels<InstructionEncoder>;

export class LabelsImpl implements Labels<InstructionEncoder> {
  labels = dict<number>();
  targets: Array<{ at: number; target: string }> = [];

  label(name: string, index: number) {
    this.labels[name] = index;
  }

  target(at: number, target: string) {
    this.targets.push({ at, target });
  }

  patch(encoder: InstructionEncoder): void {
    let { targets, labels } = this;
    for (let i = 0; i < targets.length; i++) {
      let { at, target } = targets[i];
      let address = labels[target] - at;
      encoder.patch(at, address);
    }
  }
}

export class EncoderImpl implements Encoder<InstructionEncoder, Op, MachineOp> {
  private labelsStack = new Stack<OpcodeBuilderLabels>();

  constructor(
    private encoder: InstructionEncoder,
    readonly constants: CompileTimeConstants,
    readonly stdlib: STDLib,
    readonly isEager: boolean
  ) {}

  get pos(): number {
    return this.encoder.typePos;
  }

  get nextPos(): number {
    return this.encoder.size;
  }

  commit(compiler: OpcodeBuilderCompiler<unknown>, size: number): number {
    this.push(MachineOp.Return);
    return compiler.commit(size, this.encoder.buffer);
  }

  reserve(name: Op) {
    this.encoder.encode(name, 0, -1);
  }

  reserveWithOperand(name: Op, operand: number) {
    this.encoder.encode(name, 0, -1, operand);
  }

  reserveMachine(name: MachineOp) {
    this.encoder.encode(name, OpcodeSize.MACHINE_MASK, -1);
  }

  push(name: Op | MachineOp, ...args: BuilderOperands): void {
    if (isMachineOp(name)) {
      let operands = args.map((operand, i) => this.operand(operand, i));
      return this.encoder.encode(name, OpcodeSize.MACHINE_MASK, ...operands);
    } else {
      let operands = args.map((operand, i) => this.operand(operand, i));
      return this.encoder.encode(name, 0, ...operands);
    }
  }

  operand(operand: LabelOperand, index: number): number;
  operand(operand: BuilderHandleThunk, index?: number): BuilderHandleThunk;
  operand(operand: MachineBuilderOperand, index?: number): number;
  operand(operand: MachineBuilderOperand, index?: number): Operand {
    if (typeof operand === 'number') {
      return operand;
    }

    if (typeof operand === 'function') {
      return operand;
    }

    switch (operand.type) {
      case 'string':
        return this.constants.string(operand.value);
      case 'option-string':
        if (operand.value === null) return 0;
        else return this.constants.string(operand.value);
      case 'boolean':
        return (operand.value as any) | 0;
      case 'number':
        return this.constants.number(operand.value);
      case 'array':
        return this.constants.array(operand.value);
      case 'string-array':
        return this.constants.stringArray(operand.value);
      case 'label':
        this.target(this.nextPos + index!, operand.value);
        return -1;
      case 'serializable':
        return this.constants.serializable(operand.value);
      case 'other':
        return (this.constants as LazyConstants).other(operand.value);
      case 'handle':
        return this.constants.handle(operand.value);
    }
  }

  get currentLabels(): OpcodeBuilderLabels {
    return expect(this.labelsStack.current, 'bug: not in a label stack');
  }

  label(name: string) {
    this.currentLabels.label(name, this.nextPos);
  }

  target(at: number, target: string) {
    this.currentLabels.target(at, target);
  }

  startLabels() {
    this.labelsStack.push(new LabelsImpl());
  }

  stopLabels() {
    let label = expect(this.labelsStack.pop(), 'unbalanced push and pop labels');
    label.patch(this.encoder);
  }
}
