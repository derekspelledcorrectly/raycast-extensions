import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Form,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { type Account, addAccount, getAccounts, removeAccount, setDefaultAccount, updateAccount } from "./accounts";
import { getSession, type Session } from "./api";

type AccountWithSession = Account & { sessionEmail?: string; sessionError?: boolean };

export default function Command() {
  const [accounts, setAccounts] = useState<AccountWithSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const loaded = await getAccounts();

      const withSessions = await Promise.all(
        loaded.map(async (account) => {
          try {
            const session = await getSession(account.token);
            const email = deriveEmail(session);
            return { ...account, sessionEmail: email };
          } catch {
            return { ...account, sessionError: true };
          }
        }),
      );

      setAccounts(withSessions);
    } catch (error) {
      console.error("Failed to load accounts", error);
      await showToast({ style: Toast.Style.Failure, title: "Failed to load accounts" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const handleRemove = async (account: AccountWithSession) => {
    if (
      await confirmAlert({
        title: "Remove Account",
        message: `Remove "${account.name}"? This cannot be undone.`,
        primaryAction: { title: "Remove", style: Alert.ActionStyle.Destructive },
      })
    ) {
      try {
        await removeAccount(account.id);
        await showToast({ style: Toast.Style.Success, title: "Account removed" });
        await loadAccounts();
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to remove account",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  };

  const handleSetDefault = async (account: AccountWithSession) => {
    try {
      await setDefaultAccount(account.id);
      await showToast({ style: Toast.Style.Success, title: `"${account.name}" is now the default` });
      await loadAccounts();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to set default account",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  return (
    <List isLoading={isLoading}>
      {accounts.length === 0 && !isLoading ? (
        <List.EmptyView
          title="No Accounts Configured"
          description="Press Enter to add your first Fastmail account"
          actions={
            <ActionPanel>
              <Action.Push title="Add Account" icon={Icon.Plus} target={<AccountForm onSave={loadAccounts} />} />
            </ActionPanel>
          }
        />
      ) : (
        accounts.map((account) => (
          <List.Item
            key={account.id}
            icon={account.isDefault ? { source: Icon.Star, tintColor: Color.Yellow } : Icon.Person}
            title={account.name}
            subtitle={account.sessionError ? "Invalid token" : account.sessionEmail}
            accessories={account.isDefault ? [{ tag: { value: "Default", color: Color.Blue } }] : []}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Edit Account"
                  icon={Icon.Pencil}
                  target={<AccountForm account={account} onSave={loadAccounts} />}
                />
                <Action.Push
                  title="Add Account"
                  icon={Icon.Plus}
                  target={<AccountForm onSave={loadAccounts} />}
                />
                {!account.isDefault && (
                  <Action
                    title="Set as Default"
                    icon={Icon.Star}
                    onAction={() => handleSetDefault(account)}
                  />
                )}
                <Action
                  title="Remove Account"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => handleRemove(account)}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

function deriveEmail(session: Session): string | undefined {
  return session.username || undefined;
}

function AccountForm({ account, onSave }: { account?: Account; onSave: () => Promise<void> }) {
  const { pop } = useNavigation();

  const handleSubmit = async (values: { name: string; token: string }) => {
    if (!values.name.trim() || !values.token.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Name and token are required" });
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: "Validating token..." });

    try {
      await getSession(values.token.trim());
    } catch {
      toast.style = Toast.Style.Failure;
      toast.title = "Invalid API token";
      toast.message = "Could not authenticate with Fastmail. Check your token.";
      return;
    }

    try {
      if (account) {
        await updateAccount(account.id, { name: values.name.trim(), token: values.token.trim() });
        toast.style = Toast.Style.Success;
        toast.title = "Account updated";
      } else {
        await addAccount(values.name.trim(), values.token.trim());
        toast.style = Toast.Style.Success;
        toast.title = "Account added";
      }
      await onSave();
      pop();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to save account";
      toast.message = error instanceof Error ? error.message : "Unknown error";
    }
  };

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title={account ? "Update Account" : "Add Account"} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Account Name" placeholder="e.g., Personal, Work" defaultValue={account?.name} />
      <Form.PasswordField
        id="token"
        title="API Token"
        placeholder="Enter your Fastmail API token"
        defaultValue={account?.token}
      />
    </Form>
  );
}
