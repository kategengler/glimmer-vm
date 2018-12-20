import { Macros } from './syntax';
import { debugSlice } from './debug';
import {
  CompileTimeConstants,
  CompileTimeProgram,
  CompilerBuffer,
  NamedBlocks as INamedBlocks,
  ContainingMetadata,
  CompileTimeLookup,
  CompilerArtifacts,
  CompileTimeHeap,
  STDLib,
} from '@glimmer/interfaces';
import { Statements, Core, Expression } from '@glimmer/wire-format';
import { DEBUG } from '@glimmer/local-debug-flags';
import { OpcodeBuilderEncoder, OpcodeBuilderCompiler } from './opcode-builder/interfaces';

export class CompilerImpl<Locator, Program extends CompileTimeProgram = CompileTimeProgram>
  implements OpcodeBuilderCompiler<Locator> {
  readonly isEager: boolean;

  constructor(
    private macros: Macros<Locator>,
    protected program: Program,
    readonly kind: 'eager' | 'lazy'
  ) {
    this.isEager = kind === 'eager';
  }

  get heap(): CompileTimeHeap {
    return this.program.heap;
  }

  get constants(): CompileTimeConstants {
    return this.program.constants;
  }

  get stdlib(): STDLib {
    return this.program.stdlib;
  }

  artifacts(): CompilerArtifacts {
    return {
      stdlib: this.program.stdlib,
      heap: this.program.heap,
      constants: this.constants,
    };
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

    return commit(heap, scopeSize, buffer);
  }

  patchStdlibs(): void {
    this.heap.patchStdlibs(this.stdlib);
  }
}

export function commit(heap: CompileTimeHeap, scopeSize: number, buffer: CompilerBuffer): number {
  let handle = heap.malloc();

  for (let i = 0; i < buffer.length; i++) {
    let value = buffer[i];

    if (typeof value === 'function') {
      heap.pushPlaceholder(value);
    } else if (typeof value === 'object') {
      heap.pushStdlib(value);
    } else {
      heap.push(value);
    }
  }

  heap.finishMalloc(handle, scopeSize);

  return handle;
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
