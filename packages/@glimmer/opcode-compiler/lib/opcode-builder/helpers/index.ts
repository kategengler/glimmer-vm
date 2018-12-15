import {
  Option,
  CompilableTemplate,
  ContentType,
  NamedBlocks,
  STDLib,
  CompileTimeLookup,
  ContainingMetadata,
} from '@glimmer/interfaces';
import { Op, $s0, MachineOp, $v0, SavedRegister } from '@glimmer/vm';
import {
  Block,
  When,
  str,
  strArray,
  arr,
  CompileHelper,
  serializable,
  OpcodeBuilderEncoder,
  OpcodeBuilderCompiler,
} from '../interfaces';
import { PLACEHOLDER_HANDLE, ComponentArgs } from '../../interfaces';
import * as WireFormat from '@glimmer/wire-format';
import { EMPTY_BLOCKS, NamedBlocksImpl } from '../../utils';

// TODO: WAT
import { CompilableBlockImpl } from '@glimmer/opcode-compiler';
import { CompilableBlockImpl as CompilableBlockInstance } from '../../compilable-template';
import { resolveLayoutForHandle } from '../../resolver';
import { compileArgs, expr } from './shared';
import { resolveCompilable } from './blocks';
import { pushPrimitiveReference } from './vm';
import {
  invokePreparedComponent,
  invokeStaticComponent,
  invokeComponent,
  invokeBareComponent,
} from './components';
import {
  labels,
  reserveTargetWithOperand,
  label,
  reserveMachineTarget,
  reserveTarget,
} from './labels';

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
