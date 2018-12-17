import {
  CompilableTemplate,
  ProgramSymbolTable,
  CompilableProgram as ICompilableProgram,
  Option,
  LayoutWithContext,
  BlockSymbolTable,
  ContainingMetadata,
} from '@glimmer/interfaces';
import { PLACEHOLDER_HANDLE } from './interfaces';
import { SerializedInlineBlock } from '@glimmer/wire-format';
import { OpcodeBuilderCompiler } from './opcode-builder/interfaces';
import { compile } from './compile';
import { meta } from './opcode-builder/helpers/shared';

export class CompilableProgram<Locator> implements ICompilableProgram {
  private compiled: Option<number> = null;

  constructor(
    protected compiler: OpcodeBuilderCompiler<Locator>,
    protected layout: LayoutWithContext<Locator>
  ) {}

  get symbolTable(): ProgramSymbolTable {
    return this.layout.block;
  }

  compile(isComponentAttrs: boolean): number {
    if (this.compiled !== null) return this.compiled;

    this.compiled = PLACEHOLDER_HANDLE;

    let { layout } = this;

    return (this.compiled = compile(
      layout.block.statements,
      this.compiler,
      meta(layout),
      isComponentAttrs
    ));
  }
}

export class CompilableBlockImpl<Locator> implements CompilableTemplate<BlockSymbolTable> {
  private compiled: Option<number> = null;

  constructor(
    private compiler: OpcodeBuilderCompiler<Locator>,
    private block: SerializedInlineBlock,
    private meta: ContainingMetadata<Locator>,
    private isComponentAttrs: boolean
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

    return (this.compiled = compile(
      this.block.statements,
      this.compiler,
      this.meta,
      this.isComponentAttrs
    ));
  }
}
