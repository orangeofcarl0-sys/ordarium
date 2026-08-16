export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
export type JsonObject = {
    [key: string]: JsonValue;
};
export declare function assertJsonValue(value: unknown, path?: string): asserts value is JsonValue;
export declare function canonicalJson(value: JsonValue): string;
export declare function digestJson(value: JsonValue): string;
export interface ActionSchema<T extends JsonValue> {
    readonly jsonSchema: JsonObject;
    parse(value: unknown): T;
}
export declare function defineSchema<T extends JsonValue>(jsonSchema: JsonObject, parse: (value: unknown) => T): ActionSchema<T>;
export declare const jsonValueSchema: ActionSchema<JsonValue>;
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
export type SchemaShape = Record<string, ActionSchema<JsonValue> | OptionalActionSchema<JsonValue>>;
export type InferSchema<S> = S extends ActionSchema<infer T> ? T : S extends OptionalActionSchema<infer T> ? T : never;
type OptionalKeys<S extends SchemaShape> = {
    [K in keyof S]: S[K] extends OptionalActionSchema<JsonValue> ? K : never;
}[keyof S];
type RequiredKeys<S extends SchemaShape> = Exclude<keyof S, OptionalKeys<S>>;
export type ObjectSchemaValue<S extends SchemaShape> = JsonObject & {
    [K in RequiredKeys<S>]: InferSchema<S[K]>;
} & {
    [K in OptionalKeys<S>]?: InferSchema<S[K]>;
};
export declare const schema: Readonly<{
    string(options?: StringSchemaOptions): ActionSchema<string>;
    number(options?: NumberSchemaOptions): ActionSchema<number>;
    integer(options?: NumberSchemaOptions): ActionSchema<number>;
    boolean(description?: string): ActionSchema<boolean>;
    literal<T extends JsonPrimitive>(value: T): ActionSchema<T>;
    array<T extends JsonValue>(item: ActionSchema<T>, options?: ArraySchemaOptions): ActionSchema<T[]>;
    optional<T extends JsonValue>(item: ActionSchema<T>): OptionalActionSchema<T>;
    object<S extends SchemaShape>(shape: S, options?: {
        description?: string | undefined;
        additionalProperties?: boolean | undefined;
    }): ActionSchema<ObjectSchemaValue<S>>;
}>;
export {};
//# sourceMappingURL=json.d.ts.map