import { LocalStorage, getPreferenceValues, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { randomUUID } from "crypto";
import { AuthenticationError, clearSession, getSession } from "./api";
import { deleteToken, getToken, setToken } from "./token-store";

const ACCOUNTS_KEY = "accounts";

export type Account = {
  id: string;
  name: string;
  isDefault: boolean;
};

// Account blob shape from before tokens moved to their own keys. Tokens used to
// live in the same JSON blob as metadata; token-store now owns them.
type LegacyAccount = Account & { token?: string };

export async function getAccounts(): Promise<Account[]> {
  const raw = await LocalStorage.getItem<string>(ACCOUNTS_KEY);
  if (!raw) return [];
  let parsed: LegacyAccount[];
  try {
    parsed = JSON.parse(raw) as LegacyAccount[];
  } catch (error) {
    const backupKey = `${ACCOUNTS_KEY}.corrupt.${Date.now()}`;
    console.error(`Corrupt account data in LocalStorage; preserved as ${backupKey}`, error);
    await LocalStorage.setItem(backupKey, raw);
    await LocalStorage.removeItem(ACCOUNTS_KEY);
    await showToast({
      style: Toast.Style.Failure,
      title: "Fastmail account data is corrupted",
      message: "Use Manage Fastmail Accounts to re-add your accounts.",
    });
    return [];
  }
  return migrateLegacyTokens(parsed);
}

// Idempotent: if no entry has a `token` field, just strip and return.
// Otherwise, write each token to token-store, drop it from the JSON blob,
// and persist the cleaned shape so subsequent reads short-circuit.
async function migrateLegacyTokens(parsed: LegacyAccount[]): Promise<Account[]> {
  const stripMetadata = (a: LegacyAccount): Account => ({ id: a.id, name: a.name, isDefault: a.isDefault });
  if (!parsed.some((a) => typeof a.token === "string")) {
    return parsed.map(stripMetadata);
  }

  for (const account of parsed) {
    if (typeof account.token === "string") {
      try {
        await setToken(account.id, account.token);
      } catch (error) {
        console.error(`Failed to migrate token for account "${account.name}"`, error);
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not migrate account tokens",
          message: "Open Manage Fastmail Accounts to re-enter affected tokens.",
        });
        // Leave the legacy blob untouched so a later attempt can retry.
        return parsed.map(stripMetadata);
      }
    }
  }

  const cleaned = parsed.map(stripMetadata);
  await saveAccounts(cleaned);
  return cleaned;
}

async function saveAccounts(accounts: Account[]): Promise<void> {
  await LocalStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export async function addAccount(name: string, token: string): Promise<Account> {
  const accounts = await getAccounts();
  const account: Account = {
    id: randomUUID(),
    name,
    isDefault: accounts.length === 0,
  };
  await setToken(account.id, token);
  accounts.push(account);
  await saveAccounts(accounts);
  return account;
}

export async function updateAccountName(id: string, name: string): Promise<void> {
  const accounts = await getAccounts();
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) throw new Error(`Account ${id} not found`);
  accounts[index] = { ...accounts[index], name };
  await saveAccounts(accounts);
}

export async function updateAccountToken(id: string, token: string): Promise<void> {
  const accounts = await getAccounts();
  if (!accounts.some((a) => a.id === id)) {
    throw new Error(`Account ${id} not found`);
  }
  const previous = await getToken(id);
  if (previous !== undefined) clearSession(previous);
  await setToken(id, token);
}

export async function removeAccount(id: string): Promise<void> {
  const accounts = await getAccounts();
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) return;

  const removed = accounts[index];
  const removedToken = await getToken(id);
  if (removedToken) clearSession(removedToken);
  await deleteToken(id);
  accounts.splice(index, 1);

  if (removed.isDefault && accounts.length > 0) {
    accounts[0].isDefault = true;
  }

  await saveAccounts(accounts);
}

export async function migrateIfNeeded(): Promise<void> {
  const accounts = await getAccounts();
  if (accounts.length > 0) return;

  const { api_token } = getPreferenceValues<{ api_token?: string }>();
  if (!api_token) return;

  try {
    await getSession(api_token);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      // Token is definitively bad; skip migration so we don't persist a dead token.
      console.error("Migration: legacy token is invalid, skipping", error);
      return;
    }
    // Transient error (network, DNS, 5xx). Trust the preference and migrate anyway —
    // the user had this token working before and we'd rather preserve it than orphan
    // the legacy user just because they're offline on first launch.
    console.warn("Migration: could not validate legacy token, migrating optimistically", error);
  }

  try {
    await addAccount("Fastmail", api_token);
  } catch (error) {
    console.error("Migration failed: could not save account", error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not migrate your Fastmail account",
      message: "Open Manage Fastmail Accounts to re-add it manually.",
    });
  }
}

export async function getDefaultAccount(): Promise<Account | undefined> {
  await migrateIfNeeded();
  const accounts = await getAccounts();
  return accounts.find((a) => a.isDefault);
}

export async function setDefaultAccount(id: string): Promise<void> {
  const accounts = await getAccounts();
  if (!accounts.some((a) => a.id === id)) {
    throw new Error(`Account ${id} not found`);
  }
  for (const account of accounts) {
    account.isDefault = account.id === id;
  }
  await saveAccounts(accounts);
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Account | undefined>();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    migrateIfNeeded()
      .then(() => getAccounts())
      .then((loaded) => {
        setAccounts(loaded);
        setSelectedAccount(loaded.find((a) => a.isDefault));
      })
      .catch((error) => {
        console.error("Failed to load accounts", error);
        showToast({ style: Toast.Style.Failure, title: "Failed to load accounts" });
      })
      .finally(() => setIsLoading(false));
  }, []);

  const selectAccount = useCallback(
    (id: string) => {
      setSelectedAccount(accounts.find((a) => a.id === id));
    },
    [accounts],
  );

  const reloadAccounts = async () => {
    try {
      const loaded = await getAccounts();
      setAccounts(loaded);
      setSelectedAccount(loaded.find((a) => a.isDefault));
    } catch (error) {
      console.error("Failed to reload accounts", error);
      await showToast({ style: Toast.Style.Failure, title: "Failed to reload accounts" });
    }
  };

  return { accounts, selectedAccount, selectAccount, reloadAccounts, isLoading };
}
