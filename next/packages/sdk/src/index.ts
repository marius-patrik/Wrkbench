import { Context, Service } from 'cordis';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { ToolRegistry, type FeatureDefinition, type ViewKind } from '../../core/src/index.ts';

export interface FeatureViewProps {
  viewId: string;
  path?: string;
  params: Record<string, unknown>;
  features: FeatureDefinition[];
  availableFeatures: FeatureDefinition[];
  isFeatureEnabled: (id: string) => boolean;
  enableFeature: (id: string) => void;
  openFile: (path: string) => void;
  openView: (kind: ViewKind) => void;
  disableFeature: (id: string) => void;
}
export type FeatureContribution = FeatureDefinition & { render: (props: FeatureViewProps) => ReactNode };

export class FeatureCatalog extends Service {
  private readonly entries = new Map<string, FeatureContribution>();
  private readonly listeners = new Set<() => void>();
  constructor(ctx: Context) { super(ctx, 'featureCatalog'); }
  add(feature: FeatureContribution) {
    if (this.entries.has(feature.id)) throw new Error('Feature already registered: ' + feature.id);
    this.entries.set(feature.id, feature);
    this.emitChange();
    return () => {
      if (this.entries.get(feature.id) !== feature) return;
      this.entries.delete(feature.id);
      this.emitChange();
    };
  }
  private emitChange() { this.listeners.forEach(listener => listener()); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  list(): FeatureDefinition[] { return [...this.entries.values()].map(({ render: _render, ...metadata }) => metadata); }
  get(id: string) { return this.entries.get(id); }
}
export class ToolService extends Service {
  readonly registry = new ToolRegistry();
  constructor(ctx: Context) { super(ctx, 'toolService'); }
}
export class ViewActionService extends Service {
  private openHandler: ((id: ViewKind) => void) | undefined;
  constructor(ctx: Context) { super(ctx, 'viewActions'); }
  attach(handler: (id: ViewKind) => void) {
    this.openHandler = handler;
    return () => { if (this.openHandler === handler) this.openHandler = undefined; };
  }
  open(id: ViewKind) {
    if (!this.openHandler) throw new Error('Window manager is not ready');
    this.openHandler(id);
  }
}
declare module 'cordis' {
  interface Context {
    featureCatalog: FeatureCatalog;
    toolService: ToolService;
    viewActions: ViewActionService;
  }
}
export function defineFeature(definition: FeatureContribution) {
  const activate = Object.assign((ctx: Context) => {
    ctx.effect(() => {
      const removeView = ctx.featureCatalog.add(definition);
      const removeTool = ctx.toolService.registry.register({
        id: 'feature.' + definition.id + '.open',
        label: 'Open ' + definition.title,
        description: definition.description,
        input: z.object({}),
        output: z.object({ message: z.string() }),
        run: () => {
          ctx.viewActions.open(definition.id);
          return { message: 'Opened ' + definition.title };
        },
      });
      return () => { removeTool(); removeView(); };
    });
  }, { inject: ['featureCatalog', 'toolService', 'viewActions'] });
  return { definition, activate };
}
type PluginContribution = ReturnType<typeof defineFeature>;
export interface ClientHostOptions { disabledFeatures?: ReadonlySet<string> }
export async function createClientHost(plugins: ReadonlyArray<PluginContribution>, options: ClientHostOptions = {}) {
  const root = new Context();
  await root.plugin(FeatureCatalog);
  await root.plugin(ToolService);
  await root.plugin(ViewActionService);
  const all = new Map(plugins.map(plugin => [plugin.definition.id, plugin]));
  const active = new Map<string, Awaited<ReturnType<Context['plugin']>>>();
  const enable = async (id: ViewKind) => {
    if (active.has(id)) return;
    const plugin = all.get(id);
    if (!plugin) throw new Error('Unknown feature: ' + id);
    const fiber = await root.plugin(plugin.activate);
    active.set(id, fiber);
  };
  const disable = async (id: ViewKind) => {
    const fiber = active.get(id);
    if (!fiber) return;
    await fiber.dispose();
    active.delete(id);
  };
  try {
    for (const plugin of plugins) {
      if (plugin.definition.id === 'plugins' || !options.disabledFeatures?.has(plugin.definition.id)) await enable(plugin.definition.id);
    }
  } catch (error) {
    await root.fiber.dispose();
    throw error;
  }
  return {
    root,
    catalog: root.featureCatalog,
    toolRegistry: root.toolService.registry,
    viewActions: root.viewActions,
    enable,
    disable,
    isEnabled: (id: ViewKind) => active.has(id),
    dispose: async () => { active.clear(); await root.fiber.dispose(); },
  };
}
