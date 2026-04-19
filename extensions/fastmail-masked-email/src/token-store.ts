import { LocalStorage } from "@raycast/api";

// Tokens live under their own keys, apart from the account metadata blob, so
// code that lists accounts never loads a secret. Raycast encrypts LocalStorage
// at rest and scopes it to this extension.
const tokenKey = (accountId: string) => `token:${accountId}`;

export async function getToken(accountId: string): Promise<string | undefined> {
  return LocalStorage.getItem<string>(tokenKey(accountId));
}

export async function setToken(accountId: string, token: string): Promise<void> {
  await LocalStorage.setItem(tokenKey(accountId), token);
}

export async function deleteToken(accountId: string): Promise<void> {
  await LocalStorage.removeItem(tokenKey(accountId));
}
