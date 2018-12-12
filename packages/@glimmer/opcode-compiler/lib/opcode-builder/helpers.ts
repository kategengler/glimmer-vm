import { Encoder } from './encoder';
import {
  Option,
  SymbolTable,
  CompilableBlock,
  CompilableTemplate,
  ContentType,
  NamedBlocks,
} from '@glimmer/interfaces';
import { Op, $s0, MachineOp, $sp, $v0 } from '@glimmer/vm';
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
  ContainingMetadata,
  CompilationResolver,
  CompileHelper,
  CurryComponent,
  StaticComponent,
  Component,
} from './interfaces';
import { OpcodeSize } from '@glimmer/encoder';
import { Primitive, PLACEHOLDER_HANDLE } from '../interfaces';
import * as WireFormat from '@glimmer/wire-format';
import { expressionCompiler, ATTRS_BLOCK } from '../syntax';
import { EMPTY_ARRAY } from '@glimmer/util';
import { EMPTY_BLOCKS } from '../utils';

export function main(encoder: Encoder) {
  encoder.push(Op.Main, $s0);
  invokePreparedComponent(encoder, false, false, true);
}

export function dynamicScope(encoder: Encoder, names: Option<string[]>, block: Block) {
  encoder.push(Op.PushDynamicScope);
  if (names && names.length) {
    encoder.push(Op.BindDynamicScope, { type: 'string-array', value: names });
  }
  block(encoder);
  encoder.push(Op.PopDynamicScope);
}

export function pushSymbolTable(encoder: Encoder, table: Option<SymbolTable>): void {
  if (table) {
    encoder.push(Op.PushSymbolTable, { type: 'serializable', value: table });
  } else {
    primitive(encoder, null);
  }
}

export function pushPrimitiveReference(encoder: Encoder, value: Primitive) {
  primitive(encoder, value);
  encoder.push(Op.PrimitiveReference);
}

export function primitive(encoder: Encoder, _primitive: Primitive) {
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

export function pushYieldableBlock(
  encoder: Encoder,
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
  encoder: Encoder,
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

export function resolveCompilable(encoder: Encoder, isEager: boolean) {
  if (!isEager) {
    encoder.push(Op.CompileBlock);
  }
}

export function invokeStaticComponent<Locator>(
  encoder: Encoder,
  resolver: CompilationResolver<Locator>,
  meta: ContainingMetadata<Locator>,
  { capabilities, layout, attrs, params, hash, synthetic, blocks }: StaticComponent
) {
  let { symbolTable } = layout;

  let bailOut = symbolTable.hasEval || capabilities.prepareArgs;

  if (bailOut) {
    invokeComponent(encoder, resolver, meta, {
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
    compileArgs(encoder, resolver, meta, null, hash, EMPTY_BLOCKS, synthetic);
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
        let callerBlock;

        if (symbol === ATTRS_BLOCK) {
          callerBlock = attrs;
        } else {
          callerBlock = blocks.get(symbol.slice(1));
        }

        if (callerBlock) {
          pushYieldableBlock(encoder, callerBlock, meta.isEager);
          bindings.push({ symbol: i + 1, isBlock: true });
        } else {
          pushYieldableBlock(encoder, null, meta.isEager);
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
          expr(encoder, resolver, meta, values[index]);
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

  invokeStatic(encoder, layout, meta.isEager);

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

export function invokeComponent<Locator>(
  encoder: Encoder,
  resolver: CompilationResolver<Locator>,
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

  compileArgs(encoder, resolver, meta, params, hash, blocks, synthetic);
  encoder.push(Op.PrepareArgs, $s0);

  invokePreparedComponent(encoder, blocks.has('default'), bindableBlocks, bindableAtNames, () => {
    if (layout) {
      pushSymbolTable(encoder, layout.symbolTable);
      pushCompilable(encoder, layout, meta.isEager);
      resolveCompilable(encoder, meta.isEager);
    } else {
      encoder.push(Op.GetComponentLayout, $s0);
    }

    encoder.push(Op.PopulateLayout, $s0);
  });

  encoder.push(Op.Load, $s0);
}

export function invokePreparedComponent(
  encoder: Encoder,
  hasBlock: boolean,
  bindableBlocks: boolean,
  bindableAtNames: boolean,
  populateLayout: Option<(encoder: Encoder) => void> = null
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

export function invokeBareComponent(encoder: Encoder) {
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
  encoder: Encoder,
  resolver: CompilationResolver<Locator>,
  meta: ContainingMetadata<Locator>,
  { definition, params, hash, synthetic }: CurryComponent
): void {
  let referrer = meta.referrer;

  encoder.pushMachine(MachineOp.PushFrame);
  compileArgs(encoder, resolver, meta, params, hash, EMPTY_BLOCKS, synthetic);
  encoder.push(Op.CaptureArgs);
  expr(encoder, resolver, meta, definition);
  encoder.push(Op.CurryComponent, { type: 'serializable', value: referrer });
  encoder.pushMachine(MachineOp.PopFrame);
  encoder.push(Op.Fetch, $v0);
}

export function invokeStatic(encoder: Encoder, compilable: CompilableTemplate, isEager: boolean) {
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

export function label(encoder: Encoder, name: string) {
  encoder.currentLabels.label(name, encoder.nextPos);
}

export function labels(encoder: Encoder, block: Block): void {
  encoder.startLabels();
  block(encoder);
  encoder.stopLabels();
}

export function reserveTarget(encoder: Encoder, op: Op, target: string) {
  encoder.reserve(op);
  encoder.currentLabels.target(encoder.pos, target);
}

export function reserveTargetWithOperand(
  encoder: Encoder,
  name: Op,
  operand: number,
  target: string
) {
  encoder.reserveWithOperand(name, operand);
  encoder.currentLabels.target(encoder.pos, target);
}

export function reserveMachineTarget(encoder: Encoder, name: MachineOp, target: string) {
  encoder.reserveMachine(name);
  encoder.currentLabels.target(encoder.pos, target);
}

export function switchCases(encoder: Encoder, callback: (when: When) => void) {
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
  encoder: Encoder,
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
  encoder: Encoder,
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

export function stdAppend(encoder: Encoder, trusting: boolean) {
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
  encoder: Encoder,
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

export function startDebugger(encoder: Encoder, symbols: string[], evalInfo: number[]) {
  encoder.push(Op.Debugger, strArray(symbols), arr(evalInfo));
}

export function hasBlockParams(encoder: Encoder, isEager: boolean, to: number) {
  encoder.push(Op.GetBlock, to);
  resolveCompilable(encoder, isEager);
  encoder.push(Op.HasBlockParams);
}

export function expr<Locator>(
  encoder: Encoder,
  resolver: CompilationResolver<Locator>,
  meta: ContainingMetadata<Locator>,
  expression: WireFormat.Expression
) {
  if (Array.isArray(expression)) {
    expressionCompiler().compileExpr(expression, encoder, resolver, meta);
  } else {
    primitive(encoder, expression);
    encoder.push(Op.PrimitiveReference);
  }
}

export function compileArgs<Locator>(
  encoder: Encoder,
  resolver: CompilationResolver<Locator>,
  meta: ContainingMetadata<Locator>,
  params: Option<WireFormat.Core.Params>,
  hash: Option<WireFormat.Core.Hash>,
  blocks: NamedBlocks,
  synthetic: boolean
): void {
  if (blocks.hasAny) {
    pushYieldableBlock(encoder, blocks.get('default'), meta.isEager);
    pushYieldableBlock(encoder, blocks.get('else'), meta.isEager);
    pushYieldableBlock(encoder, blocks.get('attrs'), meta.isEager);
  }

  let count = compileParams(encoder, resolver, meta, params);

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
      expr(encoder, resolver, meta, val[i]);
    }
  }

  encoder.push(Op.PushArgs, { type: 'string-array', value: names }, flags);
}

export function compileParams<Locator>(
  encoder: Encoder,
  resolver: CompilationResolver<Locator>,
  meta: ContainingMetadata<Locator>,
  params: Option<WireFormat.Core.Params>
) {
  if (!params) return 0;

  for (let i = 0; i < params.length; i++) {
    expr(encoder, resolver, meta, params[i]);
  }

  return params.length;
}

export function helper<Locator>(
  encoder: Encoder,
  resolver: CompilationResolver<Locator>,
  meta: ContainingMetadata<Locator>,
  { handle, params, hash }: CompileHelper
) {
  encoder.pushMachine(MachineOp.PushFrame);
  compileArgs(encoder, resolver, meta, params, hash, EMPTY_BLOCKS, true);
  encoder.push(Op.Helper, { type: 'handle', value: handle });
  encoder.pushMachine(MachineOp.PopFrame);
  encoder.push(Op.Fetch, $v0);
}

export function modifier<Locator>(
  encoder: Encoder,
  resolver: CompilationResolver<Locator>,
  meta: ContainingMetadata<Locator>,
  { handle, params, hash }: CompileHelper
) {
  encoder.pushMachine(MachineOp.PushFrame);
  compileArgs(encoder, resolver, meta, params, hash, EMPTY_BLOCKS, true);
  encoder.push(Op.Modifier, { type: 'handle', value: handle });
  encoder.pushMachine(MachineOp.PopFrame);
}

function sizeImmediate(encoder: Encoder, shifted: number, primitive: BuilderOperand) {
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
