import {
  NamedBlocks as INamedBlocks,
  Option,
  CompilableBlock,
  WireFormat,
} from '@glimmer/interfaces';
import { dict } from '@glimmer/util';
import { NamedBlocks } from '@glimmer/wire-format';

interface NamedBlocksDict {
  [key: string]: Option<CompilableBlock>;
}

export class NamedBlocksImpl implements INamedBlocks {
  static fromWireFormat(
    blocks: WireFormat.Core.Blocks,
    callback: (block: Option<WireFormat.SerializedInlineBlock>) => Option<CompilableBlock>
  ): INamedBlocks {
    return namedBlocks(blocks, callback);
  }

  static from(name: string, value: Option<CompilableBlock>): INamedBlocks {
    if (value === null) {
      return EMPTY_BLOCKS;
    }

    return new NamedBlocksImpl({ [name]: value });
  }

  constructor(private blocks: Option<NamedBlocksDict>) {}

  get(name: string): Option<CompilableBlock> {
    if (!this.blocks) return null;

    return this.blocks[name] || null;
  }

  has(name: string): boolean {
    let { blocks } = this;
    return blocks !== null && name in blocks;
  }

  with(name: string, block: Option<CompilableBlock>): INamedBlocks {
    let { blocks } = this;

    if (blocks) {
      return new NamedBlocksImpl({ ...blocks, [name]: block });
    } else {
      return new NamedBlocksImpl({ [name]: block });
    }
  }

  get hasAny(): boolean {
    return this.blocks !== null;
  }
}

export const EMPTY_BLOCKS = new NamedBlocksImpl(null);

function namedBlocks(
  blocks: WireFormat.Core.Blocks,
  callback: (block: Option<WireFormat.SerializedInlineBlock>) => Option<CompilableBlock>
): INamedBlocks {
  let out: NamedBlocksDict = dict();

  new NamedBlocks(blocks).forEach((key, value) => {
    out[key] = callback(value || null);
  });

  return new NamedBlocksImpl(out);
}
