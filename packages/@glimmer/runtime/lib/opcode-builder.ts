import { VersionedPathReference } from '@glimmer/reference';
import { BrandedComponentDefinition } from './component/interfaces';
import { IArguments } from './vm/arguments';

import { Option } from '@glimmer/util';

import { PublicVM } from './vm/append';
import { RuntimeResolver, WireFormat } from '@glimmer/interfaces';

export interface DynamicComponentDefinition<Locator> {
  (
    vm: PublicVM,
    args: IArguments,
    meta: WireFormat.TemplateMeta,
    resolver: RuntimeResolver<Locator>
  ): VersionedPathReference<Option<BrandedComponentDefinition>>;
}
