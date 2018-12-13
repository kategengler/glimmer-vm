import {
  CompilableTemplate,
  ProgramSymbolTable,
  CompilableProgram as ICompilableProgram,
  Option,
  LayoutWithContext,
  Opaque,
  Compiler,
  BlockSymbolTable,
  ContainingMetadata,
} from '@glimmer/interfaces';
import { PLACEHOLDER_HANDLE } from './interfaces';
import { SerializedInlineBlock } from '@glimmer/wire-format';
import { meta } from './opcode-builder/helpers';
import OpcodeBuilder from './opcode-builder/interfaces';

export class CompilableProgram<Locator> implements ICompilableProgram {
  private compiled: Option<number> = null;

  constructor(protected compiler: Compiler<Opaque>, protected layout: LayoutWithContext<Locator>) {}

  get symbolTable(): ProgramSymbolTable {
    return this.layout.block;
  }

  compile(): number {
    if (this.compiled !== null) return this.compiled;

    this.compiled = PLACEHOLDER_HANDLE;

    let { layout } = this;

    return (this.compiled = this.compiler.add(layout.block.statements, meta(layout)));
  }
}

export class CompilableBlock<Locator> implements CompilableTemplate<BlockSymbolTable> {
  private compiled: Option<number> = null;

  constructor(
    private compiler: Compiler<OpcodeBuilder<Locator>, Locator>,
    private block: SerializedInlineBlock,
    private meta: ContainingMetadata<Locator>
  ) {}

  get symbolTable(): BlockSymbolTable {
    return this.block;
  }

  compile(): number {
    if (this.compiled !== null) return this.compiled;

    // Track that compilation has started but not yet finished by temporarily
    // using a placeholder handle. In eager compilation mode, where compile()
    // may be called recursively, we use this as a signal that the handle cannot
    // be known synchronously and must be linked lazily.
    this.compiled = PLACEHOLDER_HANDLE;

    return (this.compiled = this.compiler.add(this.block.statements, this.meta));
  }
}
