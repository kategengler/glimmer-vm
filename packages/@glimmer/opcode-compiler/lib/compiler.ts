import { StdLib } from './opcode-builder/builder';
import { Macros } from './syntax';
import { debugSlice } from './debug';
import {
  Option,
  STDLib,
  CompileTimeConstants,
  CompileTimeProgram,
  CompilerBuffer,
  MaybeResolvedLayout,
  NamedBlocks as INamedBlocks,
  ContainingMetadata,
  CompileTimeLookup,
  CompilerArtifacts,
} from '@glimmer/interfaces';
import { Statements, Core, Expression } from '@glimmer/wire-format';
import { DEBUG } from '@glimmer/local-debug-flags';
import { OpcodeBuilderEncoder, OpcodeBuilderCompiler } from './opcode-builder/interfaces';
import { main, stdAppend } from './opcode-builder/helpers';
import { InstructionEncoder } from '@glimmer/encoder';
import { EncoderImpl } from './opcode-builder/encoder';
import { resolveLayoutForHandle } from './resolver';

export class CompilerImpl<Locator, Program extends CompileTimeProgram = CompileTimeProgram>
  implements OpcodeBuilderCompiler<Locator> {
  stdLib!: STDLib; // Set by this.initialize() in constructor

  readonly isEager: boolean;

  constructor(
    private macros: Macros<Locator>,
    protected program: Program,
    readonly resolver: CompileTimeLookup<Locator>,
    readonly kind: 'eager' | 'lazy'
  ) {
    this.isEager = kind === 'eager';
    this.initialize();
  }

  initialize() {
    this.stdLib = compileStd(this);
  }

  get constants(): CompileTimeConstants {
    return this.program.constants;
  }

  artifacts(): CompilerArtifacts {
    return { heap: this.program.heap, constants: this.constants };
  }

  compileInline(
    sexp: Statements.Append,
    encoder: OpcodeBuilderEncoder,
    resolver: CompileTimeLookup<Locator>,
    meta: ContainingMetadata<Locator>
  ): ['expr', Expression] | true {
    let { inlines } = this.macros;
    return inlines.compile(sexp, encoder, this, resolver, meta);
  }

  compileBlock(
    name: string,
    params: Core.Params,
    hash: Core.Hash,
    blocks: INamedBlocks,
    encoder: OpcodeBuilderEncoder,
    resolver: CompileTimeLookup<Locator>,
    compiler: OpcodeBuilderCompiler<Locator>,
    meta: ContainingMetadata<Locator>
  ): void {
    this.macros.blocks.compile(name, params, hash, blocks, encoder, resolver, compiler, meta);
  }

  commit(scopeSize: number, buffer: CompilerBuffer): number {
    let heap = this.program.heap;

    let handle = heap.malloc();

    for (let i = 0; i < buffer.length; i++) {
      let value = buffer[i];

      if (typeof value === 'function') {
        heap.pushPlaceholder(value);
      } else {
        heap.push(value);
      }
    }

    heap.finishMalloc(handle, scopeSize);

    return handle;
  }

  resolveLayoutForTag(tag: string, referrer: Locator): MaybeResolvedLayout {
    let { resolver } = this;

    let handle = resolver.lookupComponentDefinition(tag, referrer);

    if (handle === null) return { handle: null, capabilities: null, compilable: null };

    return resolveLayoutForHandle(resolver, handle);
  }

  resolveModifier(name: string, referrer: Locator): Option<number> {
    return this.resolver.lookupModifier(name, referrer);
  }

  resolveHelper(name: string, referrer: Locator): Option<number> {
    return this.resolver.lookupHelper(name, referrer);
  }
}

function compileStd<Locator>(compiler: OpcodeBuilderCompiler<Locator>): StdLib {
  let mainHandle = build(compiler, main);
  let trustingGuardedAppend = build(compiler, encoder => stdAppend(encoder, true));
  let cautiousGuardedAppend = build(compiler, encoder => stdAppend(encoder, false));
  return new StdLib(mainHandle, trustingGuardedAppend, cautiousGuardedAppend);
}

function build<Locator>(
  compiler: OpcodeBuilderCompiler<Locator>,
  callback: (builder: OpcodeBuilderEncoder) => void
): number {
  let instructionEncoder = new InstructionEncoder([]);
  let encoder = new EncoderImpl(instructionEncoder, compiler.constants);
  callback(encoder);
  return encoder.commit(compiler, 0);
}

export let debugCompiler: (compiler: OpcodeBuilderCompiler<unknown>, handle: number) => void;

if (DEBUG) {
  debugCompiler = (compiler: OpcodeBuilderCompiler<unknown>, handle: number) => {
    let { heap } = compiler['program'];
    let start = heap.getaddr(handle);
    let end = start + heap.sizeof(handle);

    debugSlice(compiler['program'], start, end);
  };
}
