export type EntityKind = "calendar_event" | "email_message" | "crm_contact";

/** One thing a provider created. Every created entity is stored with its clientRef (if any). */
export interface MockEntity {
  id: string;
  kind: EntityKind;
  clientRef?: string;
  /** Only set for providers with their own idempotency key (Email). */
  idempotencyKey?: string;
  data: Record<string, unknown>;
  createdAt: string;
}

/** Port for mock provider state. In-memory for tests, DynamoDB (`arg_mock_state`) for real runs. */
export interface MockStateStore {
  /**
   * Stores the entity. If it carries an idempotencyKey that was already used for this kind,
   * nothing is stored and the entity created first is returned (atomic, safe under parallel calls).
   */
  create(entity: MockEntity): Promise<MockEntity>;
  get(kind: EntityKind, id: string): Promise<MockEntity | undefined>;
  findByClientRef(kind: EntityKind, clientRef: string): Promise<MockEntity[]>;
}

export class InMemoryMockState implements MockStateStore {
  readonly #entities: MockEntity[] = [];

  create(entity: MockEntity): Promise<MockEntity> {
    const key = entity.idempotencyKey;
    if (key !== undefined) {
      const previous = this.#entities.find(
        (e) => e.kind === entity.kind && e.idempotencyKey === key,
      );
      if (previous) return Promise.resolve(previous);
    }
    this.#entities.push(entity);
    return Promise.resolve(entity);
  }

  get(kind: EntityKind, id: string): Promise<MockEntity | undefined> {
    return Promise.resolve(this.#entities.find((e) => e.kind === kind && e.id === id));
  }

  findByClientRef(kind: EntityKind, clientRef: string): Promise<MockEntity[]> {
    return Promise.resolve(
      this.#entities.filter((e) => e.kind === kind && e.clientRef === clientRef),
    );
  }
}
