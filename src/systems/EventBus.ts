import type { SimEvent } from '../physics/types';

export type EventListener = (events: readonly SimEvent[]) => void;

/** Fan out one deterministic simulation event batch to UI, audio and effects. */
export class EventBus {
  private listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(events: readonly SimEvent[]): void {
    if (!events.length) return;
    for (const listener of this.listeners) listener(events);
  }
}
