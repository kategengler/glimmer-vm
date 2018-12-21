import {
  CompilableProgram,
  Template,
  Option,
  LayoutWithContext,
  CompileTimeLookup,
  SerializedTemplateWithLazyBlock,
  SerializedTemplateBlock,
} from '@glimmer/interfaces';
import { assign } from '@glimmer/util';
import { CompilableProgram as CompilableProgramInstance } from './compilable-template';
import { WrappedBuilder } from './wrapped-component';
import { OpcodeBuilderCompiler } from './opcode-builder/interfaces';

export interface TemplateFactory<Locator> {
  /**
   * Template identifier, if precompiled will be the id of the
   * precompiled template.
   */
  id: string;

  /**
   * Compile time meta.
   */
  meta: Locator;

  /**
   * Used to create an environment specific singleton instance
   * of the template.
   *
   * @param {Environment} env glimmer Environment
   */
  create(
    compiler: OpcodeBuilderCompiler<Locator>,
    resolver: CompileTimeLookup<Locator>
  ): Template<Locator>;
  /**
   * Used to create an environment specific singleton instance
   * of the template.
   *
   * @param {Environment} env glimmer Environment
   * @param {Object} meta environment specific injections into meta
   */
  create<U>(
    compiler: OpcodeBuilderCompiler<Locator>,
    resolver: CompileTimeLookup<Locator>,
    meta: U
  ): Template<Locator & U>;
}

let clientId = 0;

/**
 * Wraps a template js in a template module to change it into a factory
 * that handles lazy parsing the template and to create per env singletons
 * of the template.
 */
export default function templateFactory<Locator>(
  serializedTemplate: SerializedTemplateWithLazyBlock<Locator>
): TemplateFactory<Locator>;
export default function templateFactory<Locator, U>(
  serializedTemplate: SerializedTemplateWithLazyBlock<Locator>
): TemplateFactory<Locator & U>;
export default function templateFactory<Locator>({
  id: templateId,
  meta,
  block,
}: SerializedTemplateWithLazyBlock<Locator>): TemplateFactory<Locator> {
  let parsedBlock: SerializedTemplateBlock;
  let id = templateId || `client-${clientId++}`;
  let create = (
    compiler: OpcodeBuilderCompiler<Locator>,
    resolver: CompileTimeLookup<Locator>,
    envMeta?: {}
  ) => {
    let newMeta = envMeta ? assign({}, envMeta, meta) : meta;
    if (!parsedBlock) {
      parsedBlock = JSON.parse(block);
    }
    return new TemplateImpl(compiler, resolver, { id, block: parsedBlock, referrer: newMeta });
  };
  return { id, meta, create };
}

class TemplateImpl<Locator> implements Template<Locator> {
  private layout: Option<CompilableProgram> = null;
  private partial: Option<CompilableProgram> = null;
  private wrappedLayout: Option<CompilableProgram> = null;
  public symbols: string[];
  public hasEval: boolean;
  public id: string;
  public referrer: Locator;

  constructor(
    private compiler: OpcodeBuilderCompiler<Locator>,
    private resolver: CompileTimeLookup<Locator>,
    private parsedLayout: Pick<LayoutWithContext<Locator>, 'id' | 'block' | 'referrer'>
  ) {
    let { block } = parsedLayout;
    this.symbols = block.symbols;
    this.hasEval = block.hasEval;
    this.referrer = parsedLayout.referrer;
    this.id = parsedLayout.id || `client-${clientId++}`;
  }

  asLayout(): CompilableProgram {
    if (this.layout) return this.layout;
    return (this.layout = new CompilableProgramInstance(this.compiler, this.resolver, {
      ...this.parsedLayout,
      asPartial: false,
    }));
  }

  asPartial(): CompilableProgram {
    if (this.partial) return this.partial;
    return (this.layout = new CompilableProgramInstance(this.compiler, this.resolver, {
      ...this.parsedLayout,
      asPartial: true,
    }));
  }

  asWrappedLayout(): CompilableProgram {
    if (this.wrappedLayout) return this.wrappedLayout;
    return (this.wrappedLayout = new WrappedBuilder(this.compiler, this.resolver, {
      ...this.parsedLayout,
      asPartial: false,
    }));
  }
}
