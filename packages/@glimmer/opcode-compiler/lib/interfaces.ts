import { ComponentCapabilities, CompileTimeProgram, NamedBlocks, Core } from '@glimmer/interfaces';
import { Macros } from './syntax';

export interface EagerResolver<Locator> {
  getCapabilities(locator: Locator): ComponentCapabilities;
}

export interface EagerCompilationOptions<Locator, R extends EagerResolver<Locator>> {
  resolver: R;
  program: CompileTimeProgram;
  macros: Macros<Locator>;
}

export const PLACEHOLDER_HANDLE = -1;

export type Primitive = undefined | null | boolean | number | string;

export type ComponentArgs = [Core.Params, Core.Hash, NamedBlocks];
