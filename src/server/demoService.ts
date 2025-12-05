import { randomUUID } from "crypto";

type DemoExtras = {
  requestId: string;
  type: "get" | "post";
  echo?: unknown;
  customMessage?: string;
  [key: string]: unknown;
};

type DemoInfo = {
  version: string;
  supportedMethods: string[];
};

export type DemoPayload = {
  message: string;
  timestamp: string;
  info: DemoInfo;
  extras: DemoExtras | null;
};

const demoInfo: DemoInfo = {
  version: "0.1",
  supportedMethods: ["GET", "POST"],
};

const createExtras = (type: "get" | "post", extras?: Partial<DemoExtras>) => ({
  requestId: randomUUID(),
  type,
  ...extras,
});

const createPayload = (
  message: string,
  extras: DemoExtras | null,
): DemoPayload => ({
  message,
  timestamp: new Date().toISOString(),
  info: demoInfo,
  extras,
});

export const getDemoPayload = (): DemoPayload => {
  const extras = createExtras("get");
  return createPayload("Hello from demo API", extras);
};

export const handleDemoPost = (payload: Record<string, unknown> | null) => {
  const name =
    typeof payload?.["name"] === "string" ? payload["name"].trim() : null;
  const greeting = name ? `Hello, ${name}` : "Hello from demo API";

  const extras = createExtras("post", {
    echo: payload,
    customMessage: name ? `${name} was greeted` : undefined,
  });

  return createPayload(greeting, extras);
};
