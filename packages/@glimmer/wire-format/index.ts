import {
  Statements,
  Statement,
  SexpOpcodes,
  Expressions,
  Core,
  SerializedInlineBlock,
  Option,
} from '@glimmer/interfaces';

export function is<T>(variant: number): (value: any) => value is T {
  return function(value: any): value is T {
    return Array.isArray(value) && value[0] === variant;
  };
}

// Statements
export const isFlushElement = is<Statements.FlushElement>(SexpOpcodes.FlushElement);
export const isAttrSplat = is<Statements.AttrSplat>(SexpOpcodes.AttrSplat);

export function isAttribute(val: Statement): val is Statements.Attribute {
  return (
    val[0] === SexpOpcodes.StaticAttr ||
    val[0] === SexpOpcodes.DynamicAttr ||
    val[0] === SexpOpcodes.TrustingAttr ||
    val[0] === SexpOpcodes.ComponentAttr
  );
}

export function isArgument(val: Statement): val is Statements.Argument {
  return val[0] === SexpOpcodes.StaticArg || val[0] === SexpOpcodes.DynamicArg;
}

// Expressions
export const isGet = is<Expressions.Get>(SexpOpcodes.Get);
export const isMaybeLocal = is<Expressions.MaybeLocal>(SexpOpcodes.MaybeLocal);

export class NamedBlocks {
  constructor(private blocks: Core.Blocks) {}

  get default(): Option<SerializedInlineBlock> {
    return this.getBlock('default');
  }

  get else(): Option<SerializedInlineBlock> {
    return this.getBlock('else');
  }

  forEach(callback: (key: string, value: SerializedInlineBlock) => void): void {
    let { blocks } = this;
    if (blocks === null || blocks === undefined) return;

    let [keys, values] = blocks;

    for (let i = 0; i < keys.length; i++) {
      callback(keys[i], values[i]);
    }
  }

  getBlock(name: string): Option<SerializedInlineBlock> {
    if (this.blocks === null || this.blocks === undefined) return null;

    let index = this.blocks[0].indexOf(name);

    if (index === -1) return null;

    return this.blocks[1][index];
  }
}
