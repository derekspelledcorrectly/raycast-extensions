import { LocalStorage, getPreferenceValues, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { randomUUID } from "crypto";
import { AuthenticationError, clearSession, getSession } from "./api";

const ACCOUNTS_KEY = "accounts";

export type Account = {
  id: string;
  name: string;
  token: string;
  isDefault: boolean;
};

export async function getAccounts(): Promise<Account[]> {
  const raw = await LocalStorage.getItem<string>(ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Account[];
  } catch (error) {
    // Preserve the unparseable blob under a timestamped key so the user can
    // recover their tokens via LocalStorage inspection rather than losing them.
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
}

async function saveAccounts(accounts: Account[]): Promise<void> {
  await LocalStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export async function addAccount(name: string, token: string): Promise<Account> {
  const accounts = await getAccounts();
  const account: Account = {
    id: randomUUID(),
    name,
    token,
    isDefault: accounts.length === 0,
  };
  accounts.push(account);
  await saveAccounts(accounts);
  return account;
}

export async function updateAccount(id: string, updates: Partial<Pick<Account, "name" | "token">>): Promise<void> {
  const accounts = await getAccounts();
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) throw new Error(`Account ${id} not found`);

  if (updates.token && updates.token !== accounts[index].token) {
    clearSession(accounts[index].token);
  }

  accounts[index] = { ...accounts[index], ...updates };
  await saveAccounts(accounts);
}

export async function removeAccount(id: string): Promise<void> {
  const accounts = await getAccounts();
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) return;

  const removed = accounts[index];
  clearSession(removed.token);
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
      // The user configured this token before, so nothing to warn about here.
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
