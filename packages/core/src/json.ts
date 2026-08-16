import { createHash } from "node:crypto";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function assertJsonValue(value: unknown, path = "value"): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0))
  ) {
    return;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new TypeError(`${path} must not contain sparse array holes`);
      assertJsonValue(value[index], `${path}[${index}]`);
    }
    return;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only plain JSON objects`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError(`${path} must not contain symbol keys`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${path}.${key} must be an enumerable data property`);
      }
      assertJsonValue(descriptor.value, `${path}.${key}`);
    }
    return;
  }

  throw new TypeError(`${path} is not JSON-safe`);
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: JsonValue): string {
  assertJsonValue(value);
  return JSON.stringify(canonicalize(value));
}

export function digestJson(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export interface ActionSchema<T extends JsonValue> {
  readonly jsonSchema: JsonObject;
  parse(value: unknown): T;
}

export function defineSchema<T extends JsonValue>(
  jsonSchema: JsonObject,
  parse: (value: unknown) => T,
): ActionSchema<T> {
  return Object.freeze({ jsonSchema, parse });
}

export const jsonValueSchema = defineSchema<JsonValue>({}, (value) => {
  assertJsonValue(value);
  return value;
});

export interface StringSchemaOptions {
  description?: string | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  pattern?: string | undefined;
}

export interface NumberSchemaOptions {
  description?: string | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
}

export interface ArraySchemaOptions {
  description?: string | undefined;
  minItems?: number | undefined;
  maxItems?: number | undefined;
}

export interface OptionalActionSchema<T extends JsonValue> {
  readonly optional: true;
  readonly schema: ActionSchema<T>;
}

export type SchemaShape = Record<
  string,
  ActionSchema<JsonValue> | OptionalActionSchema<JsonValue>
>;

export type InferSchema<S> = S extends ActionSchema<infer T>
  ? T
  : S extends OptionalActionSchema<infer T>
    ? T
    : never;

type OptionalKeys<S extends SchemaShape> = {
  [K in keyof S]: S[K] extends OptionalActionSchema<JsonValue> ? K : never;
}[keyof S];

type RequiredKeys<S extends SchemaShape> = Exclude<keyof S, OptionalKeys<S>>;

export type ObjectSchemaValue<S extends SchemaShape> = JsonObject & {
  [K in RequiredKeys<S>]: InferSchema<S[K]>;
} & {
  [K in OptionalKeys<S>]?: InferSchema<S[K]>;
};

function isOptionalSchema(
  value: ActionSchema<JsonValue> | OptionalActionSchema<JsonValue>,
): value is OptionalActionSchema<JsonValue> {
  return "optional" in value && value.optional === true;
}

function schemaMetadata(description: string | undefined): JsonObject {
  return description === undefined ? {} : { description };
}

function boundedNumber(
  name: string,
  value: number | undefined,
): JsonObject {
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return { [name]: value };
}

export const schema = Object.freeze({
  string(options: StringSchemaOptions = {}): ActionSchema<string> {
    const pattern = options.pattern === undefined ? undefined : new RegExp(options.pattern, "u");
    return defineSchema(
      {
        type: "string",
        ...schemaMetadata(options.description),
        ...boundedNumber("minLength", options.minLength),
        ...boundedNumber("maxLength", options.maxLength),
        ...(options.pattern === undefined ? {} : { pattern: options.pattern }),
      },
      (value) => {
        if (typeof value !== "string") throw new TypeError("expected a string");
        if (options.minLength !== undefined && value.length < options.minLength) {
          throw new TypeError(`string must have at least ${options.minLength} characters`);
        }
        if (options.maxLength !== undefined && value.length > options.maxLength) {
          throw new TypeError(`string must have at most ${options.maxLength} characters`);
        }
        if (pattern !== undefined && !pattern.test(value)) {
          throw new TypeError("string does not match the required pattern");
        }
        return value;
      },
    );
  },

  number(options: NumberSchemaOptions = {}): ActionSchema<number> {
    return defineSchema(
      {
        type: "number",
        ...schemaMetadata(options.description),
        ...(options.minimum === undefined ? {} : { minimum: options.minimum }),
        ...(options.maximum === undefined ? {} : { maximum: options.maximum }),
      },
      (value) => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new TypeError("expected a finite number");
        }
        if (options.minimum !== undefined && value < options.minimum) {
          throw new TypeError(`number must be at least ${options.minimum}`);
        }
        if (options.maximum !== undefined && value > options.maximum) {
          throw new TypeError(`number must be at most ${options.maximum}`);
        }
        return value;
      },
    );
  },

  integer(options: NumberSchemaOptions = {}): ActionSchema<number> {
    const number = schema.number(options);
    return defineSchema(
      { ...number.jsonSchema, type: "integer" },
      (value) => {
        const parsed = number.parse(value);
        if (!Number.isInteger(parsed)) throw new TypeError("expected an integer");
        return parsed;
      },
    );
  },

  boolean(description?: string): ActionSchema<boolean> {
    return defineSchema(
      { type: "boolean", ...schemaMetadata(description) },
      (value) => {
        if (typeof value !== "boolean") throw new TypeError("expected a boolean");
        return value;
      },
    );
  },

  literal<T extends JsonPrimitive>(value: T): ActionSchema<T> {
    assertJsonValue(value, "literal");
    return defineSchema({ const: value }, (candidate) => {
      if (!Object.is(candidate, value)) throw new TypeError(`expected literal ${String(value)}`);
      return value;
    });
  },

  array<T extends JsonValue>(
    item: ActionSchema<T>,
    options: ArraySchemaOptions = {},
  ): ActionSchema<T[]> {
    return defineSchema(
      {
        type: "array",
        items: item.jsonSchema,
        ...schemaMetadata(options.description),
        ...boundedNumber("minItems", options.minItems),
        ...boundedNumber("maxItems", options.maxItems),
      },
      (value) => {
        if (!Array.isArray(value)) throw new TypeError("expected an array");
        if (options.minItems !== undefined && value.length < options.minItems) {
          throw new TypeError(`array must contain at least ${options.minItems} items`);
        }
        if (options.maxItems !== undefined && value.length > options.maxItems) {
          throw new TypeError(`array must contain at most ${options.maxItems} items`);
        }
        return value.map((candidate) => item.parse(candidate));
      },
    );
  },

  optional<T extends JsonValue>(item: ActionSchema<T>): OptionalActionSchema<T> {
    return Object.freeze({ optional: true, schema: item });
  },

  object<S extends SchemaShape>(
    shape: S,
    options: { description?: string | undefined; additionalProperties?: boolean | undefined } = {},
  ): ActionSchema<ObjectSchemaValue<S>> {
    const properties: JsonObject = {};
    const required: string[] = [];
    for (const [key, item] of Object.entries(shape)) {
      properties[key] = isOptionalSchema(item) ? item.schema.jsonSchema : item.jsonSchema;
      if (!isOptionalSchema(item)) required.push(key);
    }
    const additionalProperties = options.additionalProperties ?? false;
    return defineSchema<ObjectSchemaValue<S>>(
      {
        type: "object",
        properties,
        required,
        additionalProperties,
        ...schemaMetadata(options.description),
      },
      (value) => {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          throw new TypeError("expected an object");
        }
        const source = value as Record<string, unknown>;
        if (!additionalProperties) {
          for (const key of Object.keys(source)) {
            if (!(key in shape)) throw new TypeError(`unexpected property: ${key}`);
          }
        }
        const output: JsonObject = {};
        for (const [key, item] of Object.entries(shape)) {
          const optional = isOptionalSchema(item);
          if (!(key in source)) {
            if (optional) continue;
            throw new TypeError(`missing required property: ${key}`);
          }
          output[key] = isOptionalSchema(item)
            ? item.schema.parse(source[key])
            : item.parse(source[key]);
        }
        if (additionalProperties) {
          for (const [key, item] of Object.entries(source)) {
            if (key in shape) continue;
            assertJsonValue(item, `object.${key}`);
            output[key] = item;
          }
        }
        return output as ObjectSchemaValue<S>;
      },
    );
  },
});
