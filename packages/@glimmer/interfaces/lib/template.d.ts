import { Maybe, Opaque, Option } from './core';
import { BlockSymbolTable, ProgramSymbolTable, SymbolTable } from './tier1/symbol-table';
import ComponentCapabilities from './component-capabilities';
import { CompileTimeConstants, CompileTimeHeap } from './program';
import { ComponentDefinition } from './components';
import { CompilableProgram, CompileTimeLookup } from './serialize';
import {
  Statement,
  SerializedTemplateBlock,
  Statements,
  Expression,
  Core,
  SerializedInlineBlock,
} from '@glimmer/wire-format';
import { CompileTimeProgram, Operand } from '@glimmer/interfaces';
import { Encoder } from './compile/encoder';
import { CompileTimeHeapImpl } from '@glimmer/program';

export type CompilableBlock = CompilableTemplate<BlockSymbolTable>;

export interface LayoutWithContext<Locator = Opaque> {
  id?: Option<string>;
  block: SerializedTemplateBlock;
  referrer: Locator;
  asPartial: boolean;
}

export interface BlockWithContext<Locator = Opaque> {
  block: SerializedInlineBlock;
  containingLayout: LayoutWithContext<Locator>;
}

/**
 * Environment specific template.
 */
export interface Template<Locator = Opaque> {
  /**
   * Template identifier, if precompiled will be the id of the
   * precompiled template.
   */
  id: string;

  /**
   * Template meta (both compile time and environment specific).
   */
  referrer: Locator;

  hasEval: boolean;

  /**
   * Symbols computed at compile time.
   */
  symbols: string[];

  // internal casts, these are lazily created and cached
  asLayout(): CompilableProgram;
  asPartial(): CompilableProgram;
  asWrappedLayout(): CompilableProgram;
}

export interface STDLib {
  main: number;
  'cautious-append': number;
  'trusting-append': number;
}

export type STDLibName = keyof STDLib;

export type CompilerBuffer = Array<Operand>;

export interface ResolvedLayout {
  handle: number;
  capabilities: ComponentCapabilities;
  compilable: Option<CompilableProgram>;
}

export type MaybeResolvedLayout =
  | {
      handle: null;
      capabilities: null;
      compilable: null;
    }
  | ResolvedLayout;

export interface NamedBlocks {
  get(name: string): Option<CompilableBlock>;
  has(name: string): boolean;
  with(name: string, block: Option<CompilableBlock>): NamedBlocks;
  hasAny: boolean;
}

export interface ContainingMetadata<Locator> {
  asPartial: boolean;
  evalSymbols: Option<string[]>;
  referrer: Locator;
  size: number;
}

export interface BlockCompiler<Op extends number, MachineOp extends number> {
  readonly isEager: boolean;

  // TODO: Needed because it's passed into macros -- make macros not depend
  // on the builder
  compileInline<Locator>(
    sexp: Statements.Append,
    encoder: Encoder<Locator, Op, MachineOp>,
    resolver: CompileTimeLookup<Locator>,
    meta: ContainingMetadata<Locator>
  ): ['expr', Expression] | true;

  compileBlock<Locator>(
    name: string,
    params: Core.Params,
    hash: Core.Hash,
    blocks: NamedBlocks,
    // TODO: Needed because it's passed into macros -- make macros not depend
    // on the builder
    encoder: Encoder<Locator, Op, MachineOp>,
    resolver: CompileTimeLookup<Locator>,
    meta: ContainingMetadata<Locator>
  ): void;
}

export interface CompilerArtifacts {
  heap: CompileTimeHeap;
  constants: CompileTimeConstants;
  stdlib: STDLib;
}

export interface Compiler<
  Locator,
  InstructionEncoder,
  Op extends number,
  MachineOp extends number
> {
  readonly heap: CompileTimeHeap;
  readonly constants: CompileTimeConstants;
  readonly isEager: boolean;
  readonly stdlib: STDLib;

  commit(size: number, encoder: CompilerBuffer): number;

  compileInline(
    sexp: Statements.Append,
    encoder: Encoder<InstructionEncoder, Op, MachineOp>,
    resolver: CompileTimeLookup<Locator>,
    meta: ContainingMetadata<Locator>
  ): ['expr', Expression] | true;

  compileBlock(
    name: string,
    params: Core.Params,
    hash: Core.Hash,
    blocks: NamedBlocks,
    encoder: Encoder<InstructionEncoder, Op, MachineOp>,
    resolver: CompileTimeLookup<Locator>,
    compiler: Compiler<Locator, InstructionEncoder, Op, MachineOp>,
    meta: ContainingMetadata<Locator>
  ): void;

  artifacts(): CompilerArtifacts;
  patchStdlibs(): void;
}

export interface CompilableTemplate<S = SymbolTable> {
  symbolTable: S;
  compile(): number;
}
