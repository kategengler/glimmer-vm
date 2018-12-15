import {
  Option,
  SymbolTable,
  CompilableTemplate,
  ContentType,
  NamedBlocks,
  STDLib,
  LayoutWithContext,
  CompileTimeLookup,
  ContainingMetadata,
  CompilableBlock,
} from '@glimmer/interfaces';
import { Op, $s0, MachineOp, $sp, $v0, $fp, SavedRegister, $s1 } from '@glimmer/vm';
import { PrimitiveType } from '@glimmer/program';
import {
  BuilderOperand,
  Block,
  When,
  str,
  bool,
  num,
  strArray,
  arr,
  CompileHelper,
  CurryComponent,
  StaticComponent,
  Component,
  DynamicComponent,
  serializable,
  OpcodeBuilderEncoder,
  OpcodeBuilderCompiler,
} from './interfaces';
import { OpcodeSize } from '@glimmer/encoder';
import { Primitive, PLACEHOLDER_HANDLE, ComponentArgs } from '../interfaces';
import * as WireFormat from '@glimmer/wire-format';
import { expressionCompiler, ATTRS_BLOCK } from '../syntax';
import { EMPTY_ARRAY } from '@glimmer/util';
import { EMPTY_BLOCKS, NamedBlocksImpl } from '../utils';

// TODO: WAT
import { CompilableBlockImpl, debugCompiler } from '@glimmer/opcode-compiler';
import { CompilableBlockImpl as CompilableBlockInstance } from '../compilable-template';
import { DEBUG } from '@glimmer/local-debug-flags';
import { resolveLayoutForHandle, resolveLayoutForTag } from '../resolver';

export function main(encoder: OpcodeBuilderEncoder) {
  encoder.push(Op.Main, $s0);
  invokePreparedComponent(encoder, false, false, true);
}

export function guardedAppend<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  stdlib: STDLib,
  expression: WireFormat.Expression,
  trusting: boolean
): void {
  encoder.pushMachine(MachineOp.PushFrame);

  expr(encoder, resolver, compiler, meta, expression);

  encoder.pushMachine(MachineOp.InvokeStatic, stdlib.getAppend(trusting));

  encoder.pushMachine(MachineOp.PopFrame);
}

export function dynamicScope(encoder: OpcodeBuilderEncoder, names: Option<string[]>, block: Block) {
  encoder.push(Op.PushDynamicScope);
  if (names && names.length) {
    encoder.push(Op.BindDynamicScope, { type: 'string-array', value: names });
  }
  block(encoder);
  encoder.push(Op.PopDynamicScope);
}

export function pushSymbolTable(encoder: OpcodeBuilderEncoder, table: Option<SymbolTable>): void {
  if (table) {
    encoder.push(Op.PushSymbolTable, { type: 'serializable', value: table });
  } else {
    primitive(encoder, null);
  }
}

export function pushPrimitiveReference(encoder: OpcodeBuilderEncoder, value: Primitive) {
  primitive(encoder, value);
  encoder.push(Op.PrimitiveReference);
}

export function primitive(encoder: OpcodeBuilderEncoder, _primitive: Primitive) {
  let type: PrimitiveType = PrimitiveType.NUMBER;
  let primitive: BuilderOperand;
  switch (typeof _primitive) {
    case 'number':
      if ((_primitive as number) % 1 === 0) {
        if ((_primitive as number) > -1) {
          primitive = _primitive;
        } else {
          primitive = num(_primitive);
          type = PrimitiveType.NEGATIVE;
        }
      } else {
        primitive = num(_primitive);
        type = PrimitiveType.FLOAT;
      }
      break;
    case 'string':
      primitive = str(_primitive);
      type = PrimitiveType.STRING;
      break;
    case 'boolean':
      primitive = bool(_primitive);
      type = PrimitiveType.BOOLEAN_OR_VOID;
      break;
    case 'object':
      // assume null
      primitive = 2;
      type = PrimitiveType.BOOLEAN_OR_VOID;
      break;
    case 'undefined':
      primitive = 3;
      type = PrimitiveType.BOOLEAN_OR_VOID;
      break;
    default:
      throw new Error('Invalid primitive passed to pushPrimitive');
  }

  let encoded = encoder.operand(primitive);

  let immediate = sizeImmediate(encoder, (encoded << 3) | type, primitive);
  encoder.push(Op.Primitive, immediate);
}

export function yieldBlock<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  to: number,
  params: Option<WireFormat.Core.Params>
) {
  compileArgs(encoder, resolver, compiler, meta, params, null, EMPTY_BLOCKS, false);
  encoder.push(Op.GetBlock, to);
  resolveCompilable(encoder, compiler.isEager);
  encoder.push(Op.InvokeYield);
  encoder.push(Op.PopScope);
  encoder.pushMachine(MachineOp.PopFrame);
}

export function pushYieldableBlock(
  encoder: OpcodeBuilderEncoder,
  block: Option<CompilableBlock>,
  isEager: boolean
) {
  pushSymbolTable(encoder, block && block.symbolTable);
  encoder.push(Op.PushBlockScope);

  if (block === null) {
    primitive(encoder, null);
  } else if (isEager) {
    primitive(encoder, block.compile());
  } else {
    encoder.push(Op.Constant, { type: 'other', value: block });
  }
}

export function pushCompilable(
  encoder: OpcodeBuilderEncoder,
  block: Option<CompilableTemplate>,
  isEager: boolean
) {
  if (block === null) {
    primitive(encoder, null);
  } else if (isEager) {
    primitive(encoder, block.compile());
  } else {
    encoder.push(Op.Constant, { type: 'other', value: block });
  }
}

export function resolveCompilable(encoder: OpcodeBuilderEncoder, isEager: boolean) {
  if (!isEager) {
    encoder.push(Op.CompileBlock);
  }
}

export function invokeStaticBlock<Locator>(
  encoder: OpcodeBuilderEncoder,
  compiler: OpcodeBuilderCompiler<Locator>,
  block: CompilableBlock,
  callerCount = 0
): void {
  let { parameters } = block.symbolTable;
  let calleeCount = parameters.length;
  let count = Math.min(callerCount, calleeCount);

  encoder.pushMachine(MachineOp.PushFrame);

  if (count) {
    encoder.push(Op.ChildScope);

    for (let i = 0; i < count; i++) {
      encoder.push(Op.Dup, $fp, callerCount - i);
      encoder.push(Op.SetVariable, parameters[i]);
    }
  }

  pushCompilable(encoder, block, compiler.isEager);
  resolveCompilable(encoder, compiler.isEager);
  encoder.pushMachine(MachineOp.InvokeVirtual);

  if (count) {
    encoder.push(Op.PopScope);
  }

  encoder.pushMachine(MachineOp.PopFrame);
}

export function staticComponent<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  handle: number,
  args: ComponentArgs
): void {
  let [params, hash, blocks] = args;

  if (handle !== null) {
    let { capabilities, compilable } = resolveLayoutForHandle(resolver, handle);

    if (compilable) {
      encoder.push(Op.PushComponentDefinition, { type: 'handle', value: handle });

      invokeStaticComponent(encoder, resolver, compiler, meta, {
        capabilities,
        layout: compilable,
        attrs: null,
        params,
        hash,
        synthetic: false,
        blocks,
      });
    } else {
      encoder.push(Op.PushComponentDefinition, { type: 'handle', value: handle });

      invokeComponent(encoder, resolver, compiler, meta, {
        capabilities,
        attrs: null,
        params,
        hash,
        synthetic: false,
        blocks,
      });
    }
  }
}

export function staticComponentHelper<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  tag: string,
  hash: WireFormat.Core.Hash,
  template: Option<CompilableBlock>
): boolean {
  let { handle, capabilities, compilable } = resolveLayoutForTag(resolver, tag, meta.referrer);

  if (handle !== null && capabilities !== null) {
    if (compilable) {
      if (hash) {
        for (let i = 0; i < hash.length; i = i + 2) {
          hash[i][0] = `@${hash[i][0]}`;
        }
      }

      encoder.push(Op.PushComponentDefinition, { type: 'handle', value: handle });
      invokeStaticComponent(encoder, resolver, compiler, meta, {
        capabilities,
        layout: compilable,
        attrs: null,
        params: null,
        hash,
        synthetic: false,
        blocks: NamedBlocksImpl.from('default', template),
      });

      return true;
    }
  }

  return false;
}

export function invokeStaticComponent<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  { capabilities, layout, attrs, params, hash, synthetic, blocks }: StaticComponent
) {
  let { symbolTable } = layout;

  let bailOut = symbolTable.hasEval || capabilities.prepareArgs;

  if (bailOut) {
    invokeComponent(encoder, resolver, compiler, meta, {
      capabilities,
      attrs,
      params,
      hash,
      synthetic,
      blocks,
      layout,
    });
    return;
  }

  encoder.push(Op.Fetch, $s0);
  encoder.push(Op.Dup, $sp, 1);
  encoder.push(Op.Load, $s0);

  let { symbols } = symbolTable;

  if (capabilities.createArgs) {
    encoder.pushMachine(MachineOp.PushFrame);
    compileArgs(encoder, resolver, compiler, meta, null, hash, EMPTY_BLOCKS, synthetic);
  }

  encoder.push(Op.BeginComponentTransaction);

  if (capabilities.dynamicScope) {
    encoder.push(Op.PushDynamicScope);
  }

  if (capabilities.createInstance) {
    encoder.push(Op.CreateComponent, (blocks.has('default') as any) | 0, $s0);
  }

  if (capabilities.createArgs) {
    encoder.pushMachine(MachineOp.PopFrame);
  }

  encoder.pushMachine(MachineOp.PushFrame);
  encoder.push(Op.RegisterComponentDestructor, $s0);

  let bindings: { symbol: number; isBlock: boolean }[] = [];

  encoder.push(Op.GetComponentSelf, $s0);
  bindings.push({ symbol: 0, isBlock: false });

  for (let i = 0; i < symbols.length; i++) {
    let symbol = symbols[i];

    switch (symbol.charAt(0)) {
      case '&':
        let callerBlock: Option<CompilableBlock>;

        if (symbol === ATTRS_BLOCK) {
          callerBlock = attrs;
        } else {
          callerBlock = blocks.get(symbol.slice(1));
        }

        if (callerBlock) {
          pushYieldableBlock(encoder, callerBlock, compiler.isEager);
          bindings.push({ symbol: i + 1, isBlock: true });
        } else {
          pushYieldableBlock(encoder, null, compiler.isEager);
          bindings.push({ symbol: i + 1, isBlock: true });
        }

        break;

      case '@':
        if (!hash) {
          break;
        }

        let [keys, values] = hash;
        let lookupName = symbol;

        if (synthetic) {
          lookupName = symbol.slice(1);
        }

        let index = keys.indexOf(lookupName);

        if (index !== -1) {
          expr(encoder, resolver, compiler, meta, values[index]);
          bindings.push({ symbol: i + 1, isBlock: false });
        }

        break;
    }
  }

  encoder.push(Op.RootScope, symbols.length + 1, Object.keys(blocks).length > 0 ? 1 : 0);

  for (let i = bindings.length - 1; i >= 0; i--) {
    let { symbol, isBlock } = bindings[i];

    if (isBlock) {
      encoder.push(Op.SetBlock, symbol);
    } else {
      encoder.push(Op.SetVariable, symbol);
    }
  }

  invokeStatic(encoder, layout, compiler.isEager);

  if (capabilities.createInstance) {
    encoder.push(Op.DidRenderLayout, $s0);
  }

  encoder.pushMachine(MachineOp.PopFrame);
  encoder.push(Op.PopScope);

  if (capabilities.dynamicScope) {
    encoder.push(Op.PopDynamicScope);
  }

  encoder.push(Op.CommitComponentTransaction);
  encoder.push(Op.Load, $s0);
}

export function invokeDynamicComponent<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  { definition, attrs, params, hash, synthetic, blocks }: DynamicComponent
) {
  replayable(encoder, {
    args: () => {
      expr(encoder, resolver, compiler, meta, definition);
      encoder.push(Op.Dup, $sp, 0);
      return 2;
    },

    body: () => {
      reserveTarget(encoder, Op.JumpUnless, 'ELSE');

      encoder.push(Op.ResolveDynamicComponent, { type: 'serializable', value: meta.referrer });
      encoder.push(Op.PushDynamicComponentInstance);

      invokeComponent(encoder, resolver, compiler, meta, {
        capabilities: true,
        attrs,
        params,
        hash,
        synthetic,
        blocks,
      });

      label(encoder, 'ELSE');
    },
  });
}

export function wrappedComponent<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  layout: LayoutWithContext<Locator>,
  attrsBlockNumber: number
) {
  labels(encoder, () => {
    withSavedRegister(encoder, $s1, () => {
      encoder.push(Op.GetComponentTagName, $s0);
      encoder.push(Op.PrimitiveReference);

      encoder.push(Op.Dup, $sp, 0);
    });

    reserveTarget(encoder, Op.JumpUnless, 'BODY');

    encoder.push(Op.Fetch, $s1);
    encoder.isComponentAttrs = true;
    encoder.push(Op.PutComponentOperations);
    encoder.push(Op.OpenDynamicElement);
    encoder.push(Op.DidCreateElement, $s0);
    yieldBlock(encoder, resolver, compiler, meta, attrsBlockNumber, []);
    encoder.isComponentAttrs = false;
    encoder.push(Op.FlushElement);

    label(encoder, 'BODY');

    invokeStaticBlock(encoder, compiler, blockFor(layout, compiler));

    encoder.push(Op.Fetch, $s1);
    reserveTarget(encoder, Op.JumpUnless, 'END');
    encoder.push(Op.CloseElement);

    label(encoder, 'END');
    encoder.push(Op.Load, $s1);
  });

  let handle = encoder.commit(compiler, meta.size);

  if (DEBUG) {
    debugCompiler(compiler, handle);
  }

  return handle;
}

export function invokeComponent<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  { capabilities, attrs, params, hash, synthetic, blocks: namedBlocks, layout }: Component
) {
  encoder.push(Op.Fetch, $s0);
  encoder.push(Op.Dup, $sp, 1);
  encoder.push(Op.Load, $s0);

  encoder.pushMachine(MachineOp.PushFrame);

  let bindableBlocks = !!namedBlocks;
  let bindableAtNames =
    capabilities === true || capabilities.prepareArgs || !!(hash && hash[0].length !== 0);

  let blocks = namedBlocks.with('attrs', attrs);

  compileArgs(encoder, resolver, compiler, meta, params, hash, blocks, synthetic);
  encoder.push(Op.PrepareArgs, $s0);

  invokePreparedComponent(encoder, blocks.has('default'), bindableBlocks, bindableAtNames, () => {
    if (layout) {
      pushSymbolTable(encoder, layout.symbolTable);
      pushCompilable(encoder, layout, compiler.isEager);
      resolveCompilable(encoder, compiler.isEager);
    } else {
      encoder.push(Op.GetComponentLayout, $s0);
    }

    encoder.push(Op.PopulateLayout, $s0);
  });

  encoder.push(Op.Load, $s0);
}

export function invokePreparedComponent(
  encoder: OpcodeBuilderEncoder,
  hasBlock: boolean,
  bindableBlocks: boolean,
  bindableAtNames: boolean,
  populateLayout: Option<(encoder: OpcodeBuilderEncoder) => void> = null
) {
  encoder.push(Op.BeginComponentTransaction);
  encoder.push(Op.PushDynamicScope);

  encoder.push(Op.CreateComponent, (hasBlock as any) | 0, $s0);

  // this has to run after createComponent to allow
  // for late-bound layouts, but a caller is free
  // to populate the layout earlier if it wants to
  // and do nothing here.
  if (populateLayout) populateLayout(encoder);

  encoder.push(Op.RegisterComponentDestructor, $s0);
  encoder.push(Op.GetComponentSelf, $s0);

  encoder.push(Op.VirtualRootScope, $s0);
  encoder.push(Op.SetVariable, 0);

  encoder.push(Op.SetupForEval, $s0);
  if (bindableAtNames) encoder.push(Op.SetNamedVariables, $s0);
  if (bindableBlocks) encoder.push(Op.SetBlocks, $s0);
  encoder.push(Op.Pop, 1);
  encoder.push(Op.InvokeComponentLayout, $s0);
  encoder.push(Op.DidRenderLayout, $s0);
  encoder.pushMachine(MachineOp.PopFrame);

  encoder.push(Op.PopScope);
  encoder.push(Op.PopDynamicScope);
  encoder.push(Op.CommitComponentTransaction);
}

export function invokeBareComponent(encoder: OpcodeBuilderEncoder) {
  encoder.push(Op.Fetch, $s0);
  encoder.push(Op.Dup, $sp, 1);
  encoder.push(Op.Load, $s0);

  encoder.pushMachine(MachineOp.PushFrame);
  encoder.push(Op.PushEmptyArgs);
  encoder.push(Op.PrepareArgs, $s0);

  invokePreparedComponent(encoder, false, false, true, () => {
    encoder.push(Op.GetComponentLayout, $s0);
    encoder.push(Op.PopulateLayout, $s0);
  });

  encoder.push(Op.Load, $s0);
}

export function curryComponent<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  { definition, params, hash, synthetic }: CurryComponent
): void {
  let referrer = meta.referrer;

  encoder.pushMachine(MachineOp.PushFrame);
  compileArgs(encoder, resolver, compiler, meta, params, hash, EMPTY_BLOCKS, synthetic);
  encoder.push(Op.CaptureArgs);
  expr(encoder, resolver, compiler, meta, definition);
  encoder.push(Op.CurryComponent, { type: 'serializable', value: referrer });
  encoder.pushMachine(MachineOp.PopFrame);
  encoder.push(Op.Fetch, $v0);
}

export function invokeStatic(
  encoder: OpcodeBuilderEncoder,
  compilable: CompilableTemplate,
  isEager: boolean
) {
  if (isEager) {
    let handle = compilable.compile();

    // If the handle for the invoked component is not yet known (for example,
    // because this is a recursive invocation and we're still compiling), push a
    // function that will produce the correct handle when the heap is
    // serialized.
    if (handle === PLACEHOLDER_HANDLE) {
      encoder.pushMachine(MachineOp.InvokeStatic, () => compilable.compile());
    } else {
      encoder.pushMachine(MachineOp.InvokeStatic, handle);
    }
  } else {
    encoder.push(Op.Constant, { type: 'other', value: compilable });
    encoder.push(Op.CompileBlock);
    encoder.pushMachine(MachineOp.InvokeVirtual);
  }
}

export function label(encoder: OpcodeBuilderEncoder, name: string) {
  encoder.currentLabels.label(name, encoder.nextPos);
}

export function labels(encoder: OpcodeBuilderEncoder, block: Block): void {
  encoder.startLabels();
  block(encoder);
  encoder.stopLabels();
}

export function reserveTarget(encoder: OpcodeBuilderEncoder, op: Op, target: string) {
  encoder.reserve(op);
  encoder.currentLabels.target(encoder.pos, target);
}

export function reserveTargetWithOperand(
  encoder: OpcodeBuilderEncoder,
  name: Op,
  operand: number,
  target: string
) {
  encoder.reserveWithOperand(name, operand);
  encoder.currentLabels.target(encoder.pos, target);
}

export function reserveMachineTarget(
  encoder: OpcodeBuilderEncoder,
  name: MachineOp,
  target: string
) {
  encoder.reserveMachine(name);
  encoder.currentLabels.target(encoder.pos, target);
}

export function switchCases(encoder: OpcodeBuilderEncoder, callback: (when: When) => void) {
  // Setup the switch DSL
  let clauses: Array<{ match: number; label: string; callback: () => void }> = [];

  let count = 0;

  function when(match: number, callback: () => void): void {
    clauses.push({ match, callback, label: `CLAUSE${count++}` });
  }

  // Call the callback
  callback(when);

  // Emit the opcodes for the switch
  encoder.push(Op.Enter, 2);
  encoder.push(Op.AssertSame);
  encoder.push(Op.ReifyU32);

  labels(encoder, () => {
    encoder.startLabels();

    // First, emit the jump opcodes. We don't need a jump for the last
    // opcode, since it bleeds directly into its clause.
    clauses
      .slice(0, -1)
      .forEach(clause => reserveTargetWithOperand(encoder, Op.JumpEq, clause.match, clause.label));

    // Enumerate the clauses in reverse order. Earlier matches will
    // require fewer checks.
    for (let i = clauses.length - 1; i >= 0; i--) {
      let clause = clauses[i];

      label(encoder, clause.label);
      encoder.push(Op.Pop, 2);

      clause.callback();

      // The first match is special: it is placed directly before the END
      // label, so no additional jump is needed at the end of it.
      if (i !== 0) {
        reserveMachineTarget(encoder, MachineOp.Jump, 'END');
      }
    }

    label(encoder, 'END');
  });

  encoder.push(Op.Exit);
}

/**
 * A convenience for pushing some arguments on the stack and
 * running some code if the code needs to be re-executed during
 * updating execution if some of the arguments have changed.
 *
 * # Initial Execution
 *
 * The `args` function should push zero or more arguments onto
 * the stack and return the number of arguments pushed.
 *
 * The `body` function provides the instructions to execute both
 * during initial execution and during updating execution.
 *
 * Internally, this function starts by pushing a new frame, so
 * that the body can return and sets the return point ($ra) to
 * the ENDINITIAL label.
 *
 * It then executes the `args` function, which adds instructions
 * responsible for pushing the arguments for the block to the
 * stack. These arguments will be restored to the stack before
 * updating execution.
 *
 * Next, it adds the Enter opcode, which marks the current position
 * in the DOM, and remembers the current $pc (the next instruction)
 * as the first instruction to execute during updating execution.
 *
 * Next, it runs `body`, which adds the opcodes that should
 * execute both during initial execution and during updating execution.
 * If the `body` wishes to finish early, it should Jump to the
 * `FINALLY` label.
 *
 * Next, it adds the FINALLY label, followed by:
 *
 * - the Exit opcode, which finalizes the marked DOM started by the
 *   Enter opcode.
 * - the Return opcode, which returns to the current return point
 *   ($ra).
 *
 * Finally, it adds the ENDINITIAL label followed by the PopFrame
 * instruction, which restores $fp, $sp and $ra.
 *
 * # Updating Execution
 *
 * Updating execution for this `replayable` occurs if the `body` added an
 * assertion, via one of the `JumpIf`, `JumpUnless` or `AssertSame` opcodes.
 *
 * If, during updating executon, the assertion fails, the initial VM is
 * restored, and the stored arguments are pushed onto the stack. The DOM
 * between the starting and ending markers is cleared, and the VM's cursor
 * is set to the area just cleared.
 *
 * The return point ($ra) is set to -1, the exit instruction.
 *
 * Finally, the $pc is set to to the instruction saved off by the
 * Enter opcode during initial execution, and execution proceeds as
 * usual.
 *
 * The only difference is that when a `Return` instruction is
 * encountered, the program jumps to -1 rather than the END label,
 * and the PopFrame opcode is not needed.
 */
export function replayable(
  encoder: OpcodeBuilderEncoder,
  { args, body }: { args(): number; body(): void }
): void {
  // Start a new label frame, to give END and RETURN
  // a unique meaning.
  labels(encoder, () => {
    encoder.pushMachine(MachineOp.PushFrame);

    // If the body invokes a block, its return will return to
    // END. Otherwise, the return in RETURN will return to END.
    reserveMachineTarget(encoder, MachineOp.ReturnTo, 'ENDINITIAL');

    // Push the arguments onto the stack. The args() function
    // tells us how many stack elements to retain for re-execution
    // when updating.
    let count = args();

    // Start a new updating closure, remembering `count` elements
    // from the stack. Everything after this point, and before END,
    // will execute both initially and to update the block.
    //
    // The enter and exit opcodes also track the area of the DOM
    // associated with this block. If an assertion inside the block
    // fails (for example, the test value changes from true to false
    // in an #if), the DOM is cleared and the program is re-executed,
    // restoring `count` elements to the stack and executing the
    // instructions between the enter and exit.
    encoder.push(Op.Enter, count);

    // Evaluate the body of the block. The body of the block may
    // return, which will jump execution to END during initial
    // execution, and exit the updating routine.
    body();

    // All execution paths in the body should run the FINALLY once
    // they are done. It is executed both during initial execution
    // and during updating execution.
    label(encoder, 'FINALLY');

    // Finalize the DOM.
    encoder.push(Op.Exit);

    // In initial execution, this is a noop: it returns to the
    // immediately following opcode. In updating execution, this
    // exits the updating routine.
    encoder.pushMachine(MachineOp.Return);

    // Cleanup code for the block. Runs on initial execution
    // but not on updating.
    label(encoder, 'ENDINITIAL');
    encoder.pushMachine(MachineOp.PopFrame);
  });
}

/**
 * A specialized version of the `replayable` convenience that allows the
 * caller to provide different code based upon whether the item at
 * the top of the stack is true or false.
 *
 * As in `replayable`, the `ifTrue` and `ifFalse` code can invoke `return`.
 *
 * During the initial execution, a `return` will continue execution
 * in the cleanup code, which finalizes the current DOM block and pops
 * the current frame.
 *
 * During the updating execution, a `return` will exit the updating
 * routine, as it can reuse the DOM block and is always only a single
 * frame deep.
 */
export function replayableIf(
  encoder: OpcodeBuilderEncoder,
  {
    args,
    ifTrue,
    ifFalse,
  }: {
    args(): number;
    ifTrue(): void;
    ifFalse?(): void;
  }
) {
  replayable(encoder, {
    args,

    body: () => {
      // If the conditional is false, jump to the ELSE label.
      reserveTarget(encoder, Op.JumpUnless, 'ELSE');

      // Otherwise, execute the code associated with the true branch.
      ifTrue();

      // We're done, so return. In the initial execution, this runs
      // the cleanup code. In the updating VM, it exits the updating
      // routine.
      reserveMachineTarget(encoder, MachineOp.Jump, 'FINALLY');

      label(encoder, 'ELSE');

      // If the conditional is false, and code associatied ith the
      // false branch was provided, execute it. If there was no code
      // associated with the false branch, jumping to the else statement
      // has no other behavior.
      if (ifFalse) {
        ifFalse();
      }
    },
  });
}

export function stdAppend(encoder: OpcodeBuilderEncoder, trusting: boolean) {
  encoder.push(Op.ContentType);

  switchCases(encoder, when => {
    when(ContentType.String, () => {
      if (trusting) {
        encoder.push(Op.AssertSame);
        encoder.push(Op.AppendHTML);
      } else {
        encoder.push(Op.AppendText);
      }
    });

    when(ContentType.Component, () => {
      encoder.push(Op.PushCurriedComponent);
      encoder.push(Op.PushDynamicComponentInstance);
      invokeBareComponent(encoder);
    });

    when(ContentType.SafeString, () => {
      encoder.push(Op.AssertSame);
      encoder.push(Op.AppendSafeHTML);
    });

    when(ContentType.Fragment, () => {
      encoder.push(Op.AssertSame);
      encoder.push(Op.AppendDocumentFragment);
    });

    when(ContentType.Node, () => {
      encoder.push(Op.AssertSame);
      encoder.push(Op.AppendNode);
    });
  });
}

export function staticAttr(
  encoder: OpcodeBuilderEncoder,
  _name: string,
  _namespace: Option<string>,
  _value: string
): void {
  const name = str(_name);
  const namespace = _namespace ? str(_namespace) : 0;

  if (encoder.isComponentAttrs) {
    pushPrimitiveReference(encoder, _value);
    encoder.push(Op.ComponentAttr, name, 1, namespace);
  } else {
    let value = str(_value);
    encoder.push(Op.StaticAttr, name, value, namespace);
  }
}

export function startDebugger(
  encoder: OpcodeBuilderEncoder,
  symbols: string[],
  evalInfo: number[]
) {
  encoder.push(Op.Debugger, strArray(symbols), arr(evalInfo));
}

export function hasBlockParams(encoder: OpcodeBuilderEncoder, isEager: boolean, to: number) {
  encoder.push(Op.GetBlock, to);
  resolveCompilable(encoder, isEager);
  encoder.push(Op.HasBlockParams);
}

export function expr<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  expression: WireFormat.Expression
) {
  if (Array.isArray(expression)) {
    expressionCompiler().compileSimple(expression, encoder, resolver, compiler, meta);
  } else {
    primitive(encoder, expression);
    encoder.push(Op.PrimitiveReference);
  }
}

export function compileArgs<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  params: Option<WireFormat.Core.Params>,
  hash: Option<WireFormat.Core.Hash>,
  blocks: NamedBlocks,
  synthetic: boolean
): void {
  if (blocks.hasAny) {
    pushYieldableBlock(encoder, blocks.get('default'), compiler.isEager);
    pushYieldableBlock(encoder, blocks.get('else'), compiler.isEager);
    pushYieldableBlock(encoder, blocks.get('attrs'), compiler.isEager);
  }

  let count = compileParams(encoder, resolver, compiler, meta, params);

  let flags = count << 4;

  if (synthetic) flags |= 0b1000;

  if (blocks) {
    flags |= 0b111;
  }

  let names: string[] = EMPTY_ARRAY;

  if (hash) {
    names = hash[0];
    let val = hash[1];
    for (let i = 0; i < val.length; i++) {
      expr(encoder, resolver, compiler, meta, val[i]);
    }
  }

  encoder.push(Op.PushArgs, { type: 'string-array', value: names }, flags);
}

export function compileParams<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  params: Option<WireFormat.Core.Params>
) {
  if (!params) return 0;

  for (let i = 0; i < params.length; i++) {
    expr(encoder, resolver, compiler, meta, params[i]);
  }

  return params.length;
}

export function helper<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  { handle, params, hash }: CompileHelper
) {
  encoder.pushMachine(MachineOp.PushFrame);
  compileArgs(encoder, resolver, compiler, meta, params, hash, EMPTY_BLOCKS, true);
  encoder.push(Op.Helper, { type: 'handle', value: handle });
  encoder.pushMachine(MachineOp.PopFrame);
  encoder.push(Op.Fetch, $v0);
}

export function params<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  params: Option<WireFormat.Core.Params>
) {
  if (!params) return 0;

  for (let i = 0; i < params.length; i++) {
    expr(encoder, resolver, compiler, meta, params[i]);
  }

  return params.length;
}

export function modifier<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  { handle, params, hash }: CompileHelper
) {
  encoder.pushMachine(MachineOp.PushFrame);
  compileArgs(encoder, resolver, compiler, meta, params, hash, EMPTY_BLOCKS, true);
  encoder.push(Op.Modifier, { type: 'handle', value: handle });
  encoder.pushMachine(MachineOp.PopFrame);
}

export function remoteElement(encoder: OpcodeBuilderEncoder, block: Block): void {
  encoder.push(Op.PushRemoteElement);
  block(encoder);
  encoder.push(Op.PopRemoteElement);
}

export function list(encoder: OpcodeBuilderEncoder, start: string, block: Block): void {
  reserveTarget(encoder, Op.EnterList, start);
  block(encoder);
  encoder.push(Op.ExitList);
}

export function invokePartial(
  encoder: OpcodeBuilderEncoder,
  referrer: unknown,
  symbols: string[],
  evalInfo: number[]
) {
  let _meta = serializable(referrer);
  let _symbols = strArray(symbols);
  let _evalInfo = arr(evalInfo);

  encoder.push(Op.InvokePartial, _meta, _symbols, _evalInfo);
}

export function meta<Locator>(layout: LayoutWithContext<Locator>): ContainingMetadata<Locator> {
  return {
    asPartial: layout.asPartial,
    evalSymbols: evalSymbols(layout),
    referrer: layout.referrer,
    size: layout.block.symbols.length,
  };
}

export function inlineBlock<Locator>(
  block: WireFormat.SerializedInlineBlock,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>
): CompilableBlockImpl<Locator> {
  return new CompilableBlockInstance(compiler, block, meta);
}

export function templates<Locator>(
  blocks: WireFormat.Core.Blocks,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>
): NamedBlocks {
  return NamedBlocksImpl.fromWireFormat(blocks, block => {
    if (!block) return null;

    return inlineBlock(block, compiler, meta);
  });
}

export function frame(encoder: OpcodeBuilderEncoder, block: Block): void {
  encoder.pushMachine(MachineOp.PushFrame);
  block(encoder);
  encoder.pushMachine(MachineOp.PopFrame);
}

export function withSavedRegister(
  encoder: OpcodeBuilderEncoder,
  register: SavedRegister,
  block: Block
): void {
  encoder.push(Op.Fetch, register);
  block(encoder);
  encoder.push(Op.Load, register);
}

function evalSymbols(layout: LayoutWithContext<unknown>): Option<string[]> {
  let { block } = layout;

  return block.hasEval ? block.symbols : null;
}

function sizeImmediate(encoder: OpcodeBuilderEncoder, shifted: number, primitive: BuilderOperand) {
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

function blockFor<Locator>(
  layout: LayoutWithContext,
  compiler: OpcodeBuilderCompiler<Locator>
): CompilableBlock {
  let block = {
    statements: layout.block.statements,
    parameters: EMPTY_ARRAY,
  };

  return new CompilableBlockInstance(compiler, block, meta(layout));
}
