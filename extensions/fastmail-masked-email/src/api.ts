import fetch from "node-fetch";

type Session = {
  username: string;
  capabilities: Record<string, unknown>;
  apiUrl: string;
  primaryAccounts: Record<string, string>;
};

// Thrown only on a confirmed 401 from Fastmail — callers can treat this as
// "this token is definitively bad" and distinguish it from transient network errors.
export class AuthenticationError extends Error {
  constructor(message = "Failed to authenticate, please check your API token") {
    super(message);
    this.name = "AuthenticationError";
  }
}

function getHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

const sessions = new Map<string, Session>();

async function getSession(token: string): Promise<Session> {
  const cached = sessions.get(token);
  if (cached) {
    return cached;
  }
  const headers = getHeaders(token);
  const response = await fetch("https://api.fastmail.com/jmap/session", { headers });
  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthenticationError();
    }
    throw new Error(`Fastmail API error: ${response.status} ${response.statusText}`);
  }
  const session = (await response.json()) as Session;
  if (!session.apiUrl || !session.primaryAccounts) {
    throw new Error("Fastmail returned an unexpected session response. Try again later.");
  }
  sessions.set(token, session);
  return session;
}

function clearSession(token: string) {
  sessions.delete(token);
}

type APIRequest<Method> = {
  using: string[];
  methodCalls: [string, Method, string][];
};

type APIResponse<Method> = {
  methodResponses: [string, Method, string][];
};

interface MakeRequestArgs<Request> {
  request: APIRequest<Request>;
}
async function makeRequest<Request, Response>(
  token: string,
  { request }: MakeRequestArgs<Request>,
): Promise<APIResponse<Response>> {
  const session = await getSession(token);
  const headers = getHeaders(token);

  const response = await fetch(session.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    if (response.status === 401) {
      sessions.delete(token);
    }
    throw new Error(`Fastmail API request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as APIResponse<Response>;
  if (!data.methodResponses?.length) {
    throw new Error("Fastmail returned an unexpected API response. Try again later.");
  }
  return data;
}

export { clearSession, getSession, makeRequest, type APIRequest, type APIResponse, type Session };
