import {
  ResolvedLayout,
  Option,
  CompilableProgram,
  ComponentCapabilities,
  MaybeResolvedLayout,
  CompileTimeLookup,
} from '@glimmer/interfaces';

// TODO: Unwind this
export interface HandleLayoutResolver<Locator> {
  getCapabilities(handle: number): ComponentCapabilities;
  getLayout(handle: number): Option<CompilableProgram>;
  lookupComponentDefinition(tag: string, referrer: Locator): Option<number>;
}

export function resolveLayoutForTag<Locator>(
  resolver: CompileTimeLookup<Locator>,
  tag: string,
  referrer: Locator
): MaybeResolvedLayout {
  let handle = resolver.lookupComponentDefinition(tag, referrer);

  if (handle === null) return { handle: null, capabilities: null, compilable: null };

  return resolveLayoutForHandle(resolver, handle);
}

export function resolveLayoutForHandle<Locator>(
  resolver: CompileTimeLookup<Locator>,
  handle: number
): ResolvedLayout {
  let capabilities = resolver.getCapabilities(handle);
  let compilable: Option<CompilableProgram> = null;

  if (!capabilities.dynamicLayout) {
    compilable = resolver.getLayout(handle)!;
  }

  return {
    handle,
    capabilities,
    compilable,
  };
}
