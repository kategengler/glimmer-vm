import { InstructionEncoder, OpcodeSize } from '@glimmer/encoder';
import {
  CompileTimeConstants,
  Labels,
  LabelOperand,
  BuilderHandleThunk,
  Operand,
  CompileTimeHeap,
  CompileTimeProgram,
  ContainingMetadata,
  CompileTimeLookup,
  BuilderOpcode,
  HighLevelBuilderOpcode,
  BuilderOp,
  MachineOp,
  PrimitiveType,
  SingleBuilderOperand,
  SingleBuilderOperands,
  HighLevelBuilderMap,
  HighLevelBuilderOp,
  CompileActions,
} from '@glimmer/interfaces';
import { isMachineOp } from '@glimmer/vm';
import { LazyConstants, CompileTimeHeapImpl, Program } from '@glimmer/program';
import { Stack, dict, expect } from '@glimmer/util';
import { commit } from '../compiler';
import { compileStd } from './helpers/stdlib';
import { OpcodeBuilderEncoder, num } from './interfaces';
import { ExprCompilerState, concat } from '../syntax';
import { expr, compileArgs } from './helpers/shared';

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

export function op(name: BuilderOpcode, ...args: SingleBuilderOperands): BuilderOp;
export function op<T extends HighLevelBuilderOpcode>(
  name: T,
  arg: HighLevelBuilderMap[T]
): BuilderOp;
export function op<T extends HighLevelBuilderOpcode>(
  name: BuilderOpcode | T,
  ...args: SingleBuilderOperands | [HighLevelBuilderMap[T]]
): BuilderOp | HighLevelBuilderOp<T> {
  if (typeof name === 'string') {
    return { op: name, op1: args[0] } as HighLevelBuilderOp<T>;
  } else {
    switch (args.length) {
      case 0:
        return { op: name };
      case 1:
        return { op: name, op1: args[0] } as BuilderOp;
      case 2:
        return { op: name, op1: args[0], op2: args[1] };
      case 3:
        return { op: name, op1: args[0], op2: args[1], op3: args[2] };

      default:
        throw new Error(`Exhausted: ${args}`);
    }
  }
}

export class EncoderImpl<Locator> implements OpcodeBuilderEncoder {
  private labelsStack = new Stack<OpcodeBuilderLabels>();
  private encoder: InstructionEncoder;

  constructor(
    private constants: CompileTimeConstants,
    private resolver: CompileTimeLookup<Locator>,
    private meta: ContainingMetadata<Locator>,
    readonly isEager: boolean,
    private size: number
  ) {
    this.encoder = new InstructionEncoder([]);
  }

  get state(): ExprCompilerState<Locator> {
    return {
      encoder: this,
      resolver: this.resolver,
      meta: this.meta,
    };
  }

  private get nextPos(): number {
    return this.encoder.size;
  }

  commit(heap: CompileTimeHeap): number {
    this.push(MachineOp.Return);
    return commit(heap, this.size, this.encoder.buffer);
  }

  push(name: BuilderOpcode, ...args: SingleBuilderOperands): void {
    if (isMachineOp(name)) {
      let operands = args.map((operand, i) => this.operand(operand, i));
      return this.encoder.encode(name, OpcodeSize.MACHINE_MASK, ...operands);
    } else {
      let operands = args.map((operand, i) => this.operand(operand, i));
      return this.encoder.encode(name, 0, ...operands);
    }
  }

  pushHighLevel<T extends HighLevelBuilderOpcode>(name: T, arg: HighLevelBuilderMap[T]): void {
    switch (name) {
      case HighLevelBuilderOpcode.Expr:
        let value = arg as HighLevelBuilderMap[HighLevelBuilderOpcode.Expr];
        expr(value, this.state);
        break;
      case HighLevelBuilderOpcode.Args: {
        let {
          params,
          hash,
          blocks,
          synthetic,
        } = arg as HighLevelBuilderMap[HighLevelBuilderOpcode.Args];
        compileArgs(params, hash, blocks, synthetic, this.state);
        break;
      }
      case HighLevelBuilderOpcode.Option: {
        let value = arg as HighLevelBuilderMap[HighLevelBuilderOpcode.Option];

        if (value === null) {
          return;
        } else {
          this.concat(value);
        }
      }
    }
  }

  concat(opcodes: CompileActions): void {
    concat(this, opcodes);
  }

  pushOp<T extends HighLevelBuilderOpcode>(op: BuilderOp | HighLevelBuilderOp<T>): void {
    if (isHighLevel(op)) {
      this.pushHighLevel(op.op, op.op1);
    } else {
      if (op.op3 !== undefined) {
        this.push(op.op, op.op1!, op.op2!, op.op3);
      } else if (op.op2 !== undefined) {
        this.push(op.op, op.op1!, op.op2);
      } else if (op.op1 !== undefined) {
        this.push(op.op, op.op1);
      } else {
        this.push(op.op);
      }
    }
  }

  operand(operand: LabelOperand, index: number): number;
  operand(operand: BuilderHandleThunk, index?: number): BuilderHandleThunk;
  operand(operand: SingleBuilderOperand, index?: number): number;
  operand(operand: SingleBuilderOperand | BuilderHandleThunk, index?: number): Operand {
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
        this.currentLabels.target(this.nextPos + index!, operand.value);
        return -1;
      case 'serializable':
        return this.constants.serializable(operand.value);
      case 'other':
        return (this.constants as LazyConstants).other(operand.value);
      case 'stdlib':
        return operand;
      case 'handle':
        return this.constants.handle(operand.value);
      case 'primitive': {
        let { primitive, type } = operand.value;
        let encoded = this.operand(primitive);
        return sizeImmediate(this, (encoded << 3) | type, primitive);
      }

      default:
        throw new Error(`Exhausted ${operand}`);
    }
  }

  private get currentLabels(): OpcodeBuilderLabels {
    return expect(this.labelsStack.current, 'bug: not in a label stack');
  }

  label(name: string) {
    this.currentLabels.label(name, this.nextPos);
  }

  startLabels() {
    this.labelsStack.push(new LabelsImpl());
  }

  stopLabels() {
    let label = expect(this.labelsStack.pop(), 'unbalanced push and pop labels');
    label.patch(this.encoder);
  }
}

export function program(constants: CompileTimeConstants): CompileTimeProgram {
  let heap = new CompileTimeHeapImpl();
  let stdlib = compileStd(constants, heap);

  return new Program(stdlib, constants, heap);
}

export function isHighLevel<T extends HighLevelBuilderOpcode>(
  op: BuilderOp | HighLevelBuilderOp<T>
): op is HighLevelBuilderOp<T> {
  return typeof op.op === 'string';
}

export function isBuilderOp(op: BuilderOp | HighLevelBuilderOp): op is BuilderOp {
  return typeof op.op === 'number';
}

function sizeImmediate(
  encoder: OpcodeBuilderEncoder,
  shifted: number,
  primitive: SingleBuilderOperand
) {
  if (shifted >= OpcodeSize.MAX_SIZE || shifted < 0) {
    if (typeof primitive !== 'number') {
      throw new Error(
        "This condition should only be possible if the primitive isn't already a constant"
      );
    }

    return (encoder.operand(num(primitive as number)) << 3) | PrimitiveType.BIG_NUM;
  }

  return shifted;
}
