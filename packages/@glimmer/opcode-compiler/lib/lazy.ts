import { Macros } from './syntax';
import { AbstractCompiler } from './compiler';
import {
  RuntimeResolver,
  Compiler,
  CompileTimeLookup,
  ContainingMetadata,
  CompileTimeProgram,
} from '@glimmer/interfaces';
import { Program, LazyConstants } from '@glimmer/program';
import { InstructionEncoder } from '@glimmer/encoder';
import { Op, MachineOp } from '@glimmer/vm';
import OpcodeBuilder from './opcode-builder/interfaces';
import builder from './opcode-builder/builder';

export interface LazyCompilerOptions<Locator> {
  lookup: CompileTimeLookup<Locator>;
  resolver: RuntimeResolver<Locator>;
  program: Program<Locator>;
  macros: Macros<Locator>;
}

export class LazyCompiler<Locator> extends AbstractCompiler<Locator, CompileTimeProgram>
  implements Compiler<OpcodeBuilder<Locator>, Locator, InstructionEncoder, Op, MachineOp> {
  program!: Program<Locator>; // Hides property on base class

  static create<Locator>(
    lookup: CompileTimeLookup<Locator>,
    resolver: RuntimeResolver<Locator>,
    macros: Macros<Locator>
  ): LazyCompiler<Locator> {
    let constants = new LazyConstants(resolver);
    let program = new Program<Locator>(constants);

    return new LazyCompiler(macros, program, lookup);
  }

  isEager = false;

  builderFor(meta: ContainingMetadata<Locator>): OpcodeBuilder<Locator> {
    return builder(this, meta);
  }
}
