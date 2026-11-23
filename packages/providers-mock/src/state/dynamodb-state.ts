import { DynamoDBClient, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { EntityKind, MockEntity, MockStateStore } from "./state.js";

type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

/**
 * Mock state in one DynamoDB table keyed by a single string `pk` (the `arg_mock_state` table).
 * Three kinds of items share the table:
 *   entity#<kind>#<id>      the entity itself, in attribute `entity`
 *   ref#<kind>#<clientRef>  set of entity ids with that clientRef (lookup index)
 *   idem#<kind>#<key>       claims an idempotency key for one entity id
 * A create writes all of them in one transaction, so the idempotency claim is atomic.
 */
export class DynamoMockState implements MockStateStore {
  readonly #doc: DynamoDBDocumentClient;
  readonly #table: string;

  constructor(doc: DynamoDBDocumentClient, table: string) {
    this.#doc = doc;
    this.#table = table;
  }

  async create(entity: MockEntity): Promise<MockEntity> {
    const items: TransactItem[] = [
      { Put: { TableName: this.#table, Item: { pk: entityKey(entity.kind, entity.id), entity } } },
    ];
    if (entity.clientRef !== undefined) {
      items.push({
        Update: {
          TableName: this.#table,
          Key: { pk: refKey(entity.kind, entity.clientRef) },
          UpdateExpression: "ADD ids :id",
          ExpressionAttributeValues: { ":id": new Set([entity.id]) },
        },
      });
    }
    if (entity.idempotencyKey !== undefined) {
      items.push({
        Put: {
          TableName: this.#table,
          Item: { pk: idemKey(entity.kind, entity.idempotencyKey), entityId: entity.id },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      });
    }

    try {
      await this.#doc.send(new TransactWriteCommand({ TransactItems: items }));
      return entity;
    } catch (err) {
      if (entity.idempotencyKey !== undefined && err instanceof TransactionCanceledException) {
        const claim = await this.#doc.send(
          new GetCommand({
            TableName: this.#table,
            Key: { pk: idemKey(entity.kind, entity.idempotencyKey) },
            ConsistentRead: true,
          }),
        );
        const entityId = claim.Item?.["entityId"] as string | undefined;
        if (entityId !== undefined) {
          const first = await this.get(entity.kind, entityId);
          if (first) return first;
        }
      }
      throw err;
    }
  }

  async get(kind: EntityKind, id: string): Promise<MockEntity | undefined> {
    const res = await this.#doc.send(
      new GetCommand({
        TableName: this.#table,
        Key: { pk: entityKey(kind, id) },
        ConsistentRead: true,
      }),
    );
    return res.Item?.["entity"] as MockEntity | undefined;
  }

  async findByClientRef(kind: EntityKind, clientRef: string): Promise<MockEntity[]> {
    const res = await this.#doc.send(
      new GetCommand({
        TableName: this.#table,
        Key: { pk: refKey(kind, clientRef) },
        ConsistentRead: true,
      }),
    );
    const ids = [...((res.Item?.["ids"] as Set<string> | undefined) ?? [])];
    const found = await Promise.all(ids.map((id) => this.get(kind, id)));
    return found
      .filter((e): e is MockEntity => e !== undefined)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

const entityKey = (kind: EntityKind, id: string) => `entity#${kind}#${id}`;
const refKey = (kind: EntityKind, ref: string) => `ref#${kind}#${ref}`;
const idemKey = (kind: EntityKind, key: string) => `idem#${kind}#${key}`;

export interface DynamoStateOptions {
  table: string;
  region: string;
  /** Set for DynamoDB Local; leave unset for real AWS. */
  endpoint?: string;
}

export function createDynamoMockState(options: DynamoStateOptions): DynamoMockState {
  const client = new DynamoDBClient({
    region: options.region,
    ...(options.endpoint === undefined
      ? {}
      : {
          endpoint: options.endpoint,
          // DynamoDB Local accepts any credentials; these are not real.
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        }),
  });
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return new DynamoMockState(doc, options.table);
}
