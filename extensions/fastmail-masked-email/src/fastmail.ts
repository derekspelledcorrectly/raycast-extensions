import { type APIRequest, getSession, makeRequest } from "./api";

export const MaskedEmailCapability = "https://www.fastmail.com/dev/maskedemail";

export enum MaskedEmailState {
  Pending = "pending",
  Enabled = "enabled",
  Disabled = "disabled",
  Deleted = "deleted",
}

export type MaskedEmail = {
  id: string;
  email: string;
  state: MaskedEmailState;
  forDomain: string;
  description: string;
  url: string | null;
  lastMessageAt: string;
  createdAt: string;
};

function normalisePrefix(prefix: string): string {
  return prefix
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .substring(0, 64);
}

// JMAP method-level errors are objects like `{ type: "invalidArguments", description?: "..." }`.
// `String(obj)` yields "[object Object]"; extract something human-readable instead.
function jmapErrorMessage(errorPayload: unknown): string {
  if (errorPayload && typeof errorPayload === "object") {
    const { type, description } = errorPayload as { type?: unknown; description?: unknown };
    const parts = [
      typeof type === "string" ? type : undefined,
      typeof description === "string" ? description : undefined,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(": ");
    try {
      return JSON.stringify(errorPayload);
    } catch {
      // fall through to default
    }
  }
  return String(errorPayload);
}

type MaskedEmailSet = {
  created: Record<
    string,
    {
      email: string;
    }
  >;
};

type CreateMaskedEmail = {
  accountId?: string;
  create: Record<
    string,
    {
      state: MaskedEmailState;
      description?: string;
      emailPrefix?: string;
      forDomain?: string;
    }
  >;
};

export async function createMaskedEmail(token: string, prefix = "", description = "", domain = "") {
  const session = await getSession(token);
  const request: APIRequest<CreateMaskedEmail> = {
    using: ["urn:ietf:params:jmap:core", MaskedEmailCapability],
    methodCalls: [
      [
        "MaskedEmail/set",
        {
          accountId: session.primaryAccounts[MaskedEmailCapability],
          create: {
            "raycast-masked-email": {
              state: MaskedEmailState.Pending,
              description,
              emailPrefix: normalisePrefix(prefix),
              forDomain: domain,
            },
          },
        },
        "0",
      ],
    ],
  };

  try {
    const response = await makeRequest<CreateMaskedEmail, MaskedEmailSet>(token, { request });
    const methodResponse = response.methodResponses[0];

    if (!methodResponse[1].created) {
      throw new Error(methodResponse[0] === "error" ? jmapErrorMessage(methodResponse[1]) : "No email was created");
    }

    return Object.values(methodResponse[1].created)[0].email;
  } catch (error) {
    throw new Error(`Failed to create masked email: ${error}`);
  }
}

type ListMaskedEmail = {
  accountId?: string;
  get: {
    ids: [string] | null;
  };
};

type MaskedEmailGet = {
  list: [MaskedEmail];
};

export async function retrieveAllMaskedEmails(token: string) {
  const session = await getSession(token);
  const request: APIRequest<ListMaskedEmail> = {
    using: ["urn:ietf:params:jmap:core", MaskedEmailCapability],
    methodCalls: [
      [
        "MaskedEmail/get",
        {
          accountId: session.primaryAccounts[MaskedEmailCapability],
          get: {
            ids: null,
          },
        },
        "0",
      ],
    ],
  };

  try {
    const response = await makeRequest<ListMaskedEmail, MaskedEmailGet>(token, { request });
    const methodResponse = response.methodResponses[0];

    if (!methodResponse[1].list) {
      throw new Error(methodResponse[0] === "error" ? jmapErrorMessage(methodResponse[1]) : "No emails returned");
    }

    return methodResponse[1].list;
  } catch (error) {
    throw new Error(`Failed to retrieve all masked emails: ${error}`);
  }
}

type UpdateMaskedEmail = {
  accountId?: string;
  update: Record<
    string,
    {
      state: MaskedEmailState;
      description?: string;
      emailPrefix?: string;
    }
  >;
};

export async function updateMaskedEmailState(token: string, email: MaskedEmail, state: MaskedEmailState) {
  const session = await getSession(token);
  const request: APIRequest<UpdateMaskedEmail> = {
    using: ["urn:ietf:params:jmap:core", MaskedEmailCapability],
    methodCalls: [
      [
        "MaskedEmail/set",
        {
          accountId: session.primaryAccounts[MaskedEmailCapability],
          update: {
            [email.id]: {
              state,
            },
          },
        },
        "0",
      ],
    ],
  };

  const response = await makeRequest<UpdateMaskedEmail, MaskedEmailSet>(token, { request });
  const methodResponse = response.methodResponses[0];

  if (methodResponse[0] === "error") {
    throw new Error(`Failed to update masked email: ${jmapErrorMessage(methodResponse[1])}`);
  }
}
