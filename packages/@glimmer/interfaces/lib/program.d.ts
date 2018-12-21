import { Opaque, Unique, Option } from './core';
import { STDLib } from './template';
import { StdlibOperand } from './compile';
import { Op } from './vm-opcodes';

export interface Opcode {
  offset: number;
  type: number;
  op1: number;
  op2: number;
  op3: number;
  size: number;
  isMachine: 0 | 1;
}

export type VMHandle = Unique<'Handle'>;

export interface SerializedHeap {
  buffer: ArrayBuffer;
  table: number[];
  handle: number;
}

export interface CompileTimeHeap {
  push(name: Op, op1?: number, op2?: number, op3?: number): void;
  pushPlaceholder(valueFunc: () => number): void;
  pushStdlib(stdlib: StdlibOperand): void;
  patchStdlibs(stdlib: STDLib): void;
  malloc(): number;
  finishMalloc(handle: number, scopeSize: number): void;
  capture(stdlib: STDLib, offset?: number): SerializedHeap;

  // for debugging
  getaddr(handle: number): number;
  sizeof(handle: number): number;
}

export interface RuntimeHeap {
  // for debugging
  getaddr(handle: number): number;
  sizeof(handle: number): number;
  getbyaddr(address: number): number;
  scopesizeof(handle: number): number;
}

export interface CompileTimeProgram {
  [key: number]: never;

  readonly stdlib: STDLib;
  readonly constants: CompileTimeConstants;
  readonly heap: CompileTimeHeap;
}

export type EMPTY_ARRAY = Array<ReadonlyArray<never>>;

export interface ConstantPool {
  strings: string[];
  arrays: number[][] | EMPTY_ARRAY;
  handles: number[];
  numbers: number[];
}

/**
 * Constants are interned values that are referenced as numbers in the program.
 * The constant pool is a part of the program, and is always transmitted
 * together with the program.
 */
export interface CompileTimeConstants<Locator = unknown> {
  string(value: string): number;
  stringArray(strings: string[]): number;
  array(values: number[]): number;
  handle(locator: Locator): number;
  serializable(value: unknown): number;
  number(value: number): number;
  toPool(): ConstantPool;
}

/**
 * In JIT mode, the constant pool is allowed to store arbitrary values,
 * which don't need to be serialized or transmitted over the wire.
 */
export interface CompileTimeLazyConstants extends CompileTimeConstants {
  other(value: Opaque): number;
}
