export * from './lib/interfaces';

export { ATTRS_BLOCK, Macros } from './lib/syntax';

export { LazyCompilerOptions, LazyCompiler } from './lib/lazy';
export { compile } from './lib/compile';
export { AbstractCompiler, debugCompiler } from './lib/compiler';

export { CompilableBlockImpl, CompilableProgram } from './lib/compilable-template';
export { invokeStaticBlock, staticComponent } from './lib/opcode-builder/helpers';

export {
  default as OpcodeBuilder,
  OpcodeBuilderConstructor,
} from './lib/opcode-builder/interfaces';

export { default as builder } from './lib/opcode-builder/builder';

export { PartialDefinition } from './lib/partial-template';

export { default as templateFactory, TemplateFactory } from './lib/template';

export { debug, debugSlice, logOpcode } from './lib/debug';

export { WrappedBuilder } from './lib/wrapped-component';

export { EMPTY_BLOCKS } from './lib/utils';

export { resolveLayoutForTag } from './lib/resolver';
