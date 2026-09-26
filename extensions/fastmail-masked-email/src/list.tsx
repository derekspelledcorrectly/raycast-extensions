import { Action, ActionPanel, Color, Icon, Image, List, Toast, showToast } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Account, useAccounts } from "./accounts";
import { MaskedEmail, MaskedEmailState, updateMaskedEmailState, retrieveAllMaskedEmails } from "./fastmail";
import { getToken } from "./token-store";

type MaskedEmailStateFilter = MaskedEmailState | "";
type TaggedMaskedEmail = MaskedEmail & { accountId: string; accountName: string };
type FailedAccount = { id: string; name: string; reason: string };

const ACCOUNT_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
const ALL_ACCOUNTS = "all";

// Avoid the state-tag colors (Blue/Green/Orange/Red) so account tags stay visually distinct.
const ACCOUNT_COLORS = [Color.Purple, Color.Yellow, Color.Magenta] as const;

const colorForAccountIndex = (index: number): Color =>
  ACCOUNT_COLORS[((index % ACCOUNT_COLORS.length) + ACCOUNT_COLORS.length) % ACCOUNT_COLORS.length];

const describeReason = (reason: unknown): string =>
  reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Unknown error";

export default function Command() {
  const { accounts, selectedAccount, selectAccount, isLoading: accountsLoading } = useAccounts();
  const [maskedEmails, setMaskedEmails] = useState<TaggedMaskedEmail[]>([]);
  const [failedAccounts, setFailedAccounts] = useState<FailedAccount[]>([]);
  const [filter, setFilter] = useState<MaskedEmailStateFilter>("");
  const [allAccountsMode, setAllAccountsMode] = useState(false);
  const [emailsLoading, setEmailsLoading] = useState(false);

  const loadEmailsForAccount = useCallback(async (account: Account): Promise<TaggedMaskedEmail[]> => {
    const token = await getToken(account.id);
    if (!token) throw new Error(`No token stored for "${account.name}"`);
    const emails = await retrieveAllMaskedEmails(token);
    return emails.map((e) => ({ ...e, accountId: account.id, accountName: account.name }));
  }, []);

  const loadAllAccounts = useCallback(
    async (activeAccounts: Account[]) => {
      setEmailsLoading(true);
      try {
        const results = await Promise.allSettled(activeAccounts.map(loadEmailsForAccount));
        const combined: TaggedMaskedEmail[] = [];
        const failed: FailedAccount[] = [];
        results.forEach((result, i) => {
          const account = activeAccounts[i];
          if (result.status === "fulfilled") {
            combined.push(...result.value);
          } else {
            console.error(`Failed to load masked emails for account "${account.name}"`, result.reason);
            failed.push({ id: account.id, name: account.name, reason: describeReason(result.reason) });
          }
        });
        setMaskedEmails(combined);
        setFailedAccounts(failed);
        if (failed.length > 0) {
          await showToast({
            style: Toast.Style.Failure,
            title: `Failed to load ${failed.length} of ${activeAccounts.length} account${activeAccounts.length > 1 ? "s" : ""}`,
            message: failed.map((f) => f.name).join(", "),
          });
        }
      } finally {
        setEmailsLoading(false);
      }
    },
    [loadEmailsForAccount],
  );

  const loadSingleAccount = useCallback(
    async (account: Account) => {
      setEmailsLoading(true);
      setFailedAccounts([]);
      try {
        const tagged = await loadEmailsForAccount(account);
        setMaskedEmails(tagged);
      } catch (error) {
        console.error(`Failed to load masked emails for account "${account.name}"`, error);
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to load masked emails",
          message: error instanceof Error ? error.message : "Check your account token and try again.",
        });
        setMaskedEmails([]);
      } finally {
        setEmailsLoading(false);
      }
    },
    [loadEmailsForAccount],
  );

  const retryAccount = useCallback(
    async (accountId: string) => {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) return;
      const toast = await showToast({ style: Toast.Style.Animated, title: `Retrying ${account.name}...` });
      try {
        const tagged = await loadEmailsForAccount(account);
        setMaskedEmails((prev) => [...prev.filter((e) => e.accountId !== account.id), ...tagged]);
        setFailedAccounts((prev) => prev.filter((f) => f.id !== account.id));
        toast.style = Toast.Style.Success;
        toast.title = `Loaded ${account.name}`;
      } catch (error) {
        console.error(`Retry failed for account "${account.name}"`, error);
        const reason = describeReason(error);
        setFailedAccounts((prev) => prev.map((f) => (f.id === account.id ? { ...f, reason } : f)));
        toast.style = Toast.Style.Failure;
        toast.title = `Still failing: ${account.name}`;
        toast.message = reason;
      }
    },
    [accounts, loadEmailsForAccount],
  );

  // Stable content-based key so the fetch effect only re-runs when the set of
  // accounts actually changes, not whenever useAccounts returns a fresh array
  // reference. Tokens live in token-store and aren't surfaced through the
  // metadata; rotations happen out-of-band via Manage Fastmail Accounts.
  const accountsKey = useMemo(() => accounts.map((a) => a.id).join(","), [accounts]);

  useEffect(() => {
    if (allAccountsMode) {
      if (accounts.length > 0) loadAllAccounts(accounts);
    } else if (selectedAccount) {
      loadSingleAccount(selectedAccount);
    }
    // `accounts` is intentionally omitted; accountsKey drives content-sensitive reloads.
  }, [allAccountsMode, selectedAccount, accountsKey, loadAllAccounts, loadSingleAccount]);

  const handleDropdownChange = (value: string) => {
    if (value === `account:${ALL_ACCOUNTS}`) {
      switchToAllAccounts();
    } else if (value.startsWith("account:")) {
      switchToAccount(value.slice("account:".length));
    } else if (value.startsWith("state:")) {
      setFilter(value.slice("state:".length) as MaskedEmailStateFilter);
    }
  };

  const switchToAccount = (id: string) => {
    if (!allAccountsMode && selectedAccount?.id === id) return;
    setAllAccountsMode(false);
    selectAccount(id);
    setFilter("");
  };

  const switchToAllAccounts = () => {
    if (allAccountsMode) return;
    setAllAccountsMode(true);
    setFilter("");
  };

  const updateMaskedEmail = async (email: TaggedMaskedEmail, state: MaskedEmailState) => {
    const account = accounts.find((a) => a.id === email.accountId);
    if (!account) throw new Error(`Account for masked email ${email.email} no longer available`);
    const token = await getToken(account.id);
    if (!token) throw new Error(`No token stored for "${account.name}"`);
    await updateMaskedEmailState(token, email, state);
    setMaskedEmails((prev) =>
      prev.map((e) => (e.id === email.id && e.accountId === email.accountId ? { ...e, state } : e)),
    );
  };

  const toggleMaskedEmail = async (email: TaggedMaskedEmail) => {
    const state = email.state === MaskedEmailState.Enabled ? MaskedEmailState.Disabled : MaskedEmailState.Enabled;
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `${state === MaskedEmailState.Disabled ? "Blocking" : "Unblocking"} masked email...`,
    });

    try {
      await updateMaskedEmail(email, state);

      toast.style = Toast.Style.Success;
      toast.title = `Masked email ${state === MaskedEmailState.Disabled ? "blocked" : "unblocked"}`;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = `Failed to ${state === MaskedEmailState.Disabled ? "block" : "unblock"} masked email`;
      toast.message =
        error instanceof Error
          ? error.message
          : "An error occurred while updating the masked email, please try again later";
    }
  };

  const deleteMaskedEmail = async (email: TaggedMaskedEmail) => {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Deleting masked email..." });

    try {
      await updateMaskedEmail(email, MaskedEmailState.Deleted);

      toast.style = Toast.Style.Success;
      toast.title = "Masked email deleted";
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to delete masked email";
      toast.message =
        error instanceof Error
          ? error.message
          : "An error occurred while updating the masked email, please try again later";
    }
  };

  const restoreMaskedEmail = async (email: TaggedMaskedEmail) => {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Restoring masked email..." });

    try {
      await updateMaskedEmail(email, MaskedEmailState.Enabled);

      toast.style = Toast.Style.Success;
      toast.title = "Masked email restored";
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to restore masked email";
      toast.message =
        error instanceof Error
          ? error.message
          : "An error occurred while updating the masked email, please try again later";
    }
  };

  const filteredSortedMaskedEmails = useMemo(() => {
    const sortOrder: { [key in MaskedEmailState]: number } = {
      [MaskedEmailState.Deleted]: 0,
      [MaskedEmailState.Disabled]: 1,
      [MaskedEmailState.Pending]: 2,
      [MaskedEmailState.Enabled]: 3,
    };

    return maskedEmails
      .filter((email) => {
        if (filter === "") {
          return true;
        }

        return email.state === filter;
      })
      .sort((lhs, rhs) => new Date(rhs.createdAt).getTime() - new Date(lhs.createdAt).getTime())
      .sort((lhs, rhs) => sortOrder[rhs.state] - sortOrder[lhs.state]);
  }, [maskedEmails, filter]);

  if (!accountsLoading && accounts.length === 0) {
    return (
      <List>
        <List.EmptyView
          title="No Accounts Configured"
          description='Use the "Manage Fastmail Accounts" command to add an account'
        />
      </List>
    );
  }

  const dropdownValue = allAccountsMode
    ? `account:${ALL_ACCOUNTS}`
    : filter !== ""
      ? `state:${filter}`
      : selectedAccount
        ? `account:${selectedAccount.id}`
        : undefined;

  return (
    <List
      isLoading={accountsLoading || emailsLoading}
      searchBarAccessory={
        <List.Dropdown tooltip="Filter" value={dropdownValue} onChange={handleDropdownChange}>
          {accounts.length > 1 && (
            <List.Dropdown.Section title="Account">
              <List.Dropdown.Item title="All Accounts" value={`account:${ALL_ACCOUNTS}`} />
              {accounts.map((account) => (
                <List.Dropdown.Item key={account.id} title={account.name} value={`account:${account.id}`} />
              ))}
            </List.Dropdown.Section>
          )}
          <List.Dropdown.Section title="State">
            <List.Dropdown.Item title="All" value="state:" />
            <List.Dropdown.Item title="Active" value={`state:${MaskedEmailState.Enabled}`} />
            <List.Dropdown.Item title="Blocked" value={`state:${MaskedEmailState.Disabled}`} />
            <List.Dropdown.Item title="Pending" value={`state:${MaskedEmailState.Pending}`} />
            <List.Dropdown.Item title="Deleted" value={`state:${MaskedEmailState.Deleted}`} />
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {allAccountsMode && failedAccounts.length > 0 && (
        <List.Section
          title="Failed to Load"
          subtitle={`${failedAccounts.length} of ${accounts.length} account${accounts.length > 1 ? "s" : ""}`}
        >
          {failedAccounts.map((failed) => (
            <List.Item
              key={`failed:${failed.id}`}
              icon={{ source: Icon.ExclamationMark, tintColor: Color.Red }}
              title={failed.name}
              subtitle={failed.reason}
              accessories={[{ tag: { value: "Failed", color: Color.Red }, tooltip: null }]}
              actions={
                <ActionPanel title={`${failed.name} — failed to load`}>
                  <Action
                    icon={Icon.RotateClockwise}
                    title="Retry This Account"
                    onAction={() => retryAccount(failed.id)}
                  />
                  <Action icon={Icon.Repeat} title="Retry All Accounts" onAction={() => loadAllAccounts(accounts)} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
      {filteredSortedMaskedEmails.map((email) => {
        const canBlockUnblock = [MaskedEmailState.Enabled, MaskedEmailState.Disabled].includes(email.state);
        const canRestore = email.state === MaskedEmailState.Deleted;
        const canView = email.state !== MaskedEmailState.Pending;

        const accessories: List.Item.Accessory[] = [];
        if (allAccountsMode && accounts.length > 1) {
          const accountIndex = accounts.findIndex((a) => a.id === email.accountId);
          accessories.push({
            tag: { value: email.accountName, color: colorForAccountIndex(accountIndex) },
            tooltip: null,
          });
        }
        accessories.push({
          date: new Date(email.createdAt),
          tooltip: `Created ${new Date(email.createdAt).toLocaleString()}`,
        });
        accessories.push(accessoryForMaskedEmail(email));

        return (
          <List.Item
            icon={iconForMaskedEmail(email)}
            key={`${email.accountId}:${email.id}`}
            title={email.email}
            subtitle={email.forDomain || email.description}
            keywords={[email.description, email.forDomain, email.accountName]}
            accessories={accessories}
            actions={
              <ActionPanel title={email.email}>
                <Action.CopyToClipboard title="Copy Masked Email" content={email.email} />
                {canBlockUnblock && (
                  <Action
                    icon={email.state === MaskedEmailState.Enabled ? Icon.Stop : Icon.Play}
                    title={`${email.state === MaskedEmailState.Enabled ? "Block" : "Unblock"} Masked Email`}
                    onAction={() => toggleMaskedEmail(email)}
                  />
                )}
                {canBlockUnblock && (
                  <Action icon={Icon.Trash} title="Delete Masked Email" onAction={() => deleteMaskedEmail(email)} />
                )}
                {canRestore && (
                  <Action icon={Icon.Undo} title="Restore Masked Email" onAction={() => restoreMaskedEmail(email)} />
                )}
                {canView && (
                  <Action.OpenInBrowser
                    title="View in Fastmail"
                    url={`https://app.fastmail.com/settings/masked/${email.id}`}
                  />
                )}
                {accounts.length > 1 && (
                  <ActionPanel.Section title="Switch Account">
                    <Action
                      icon={Icon.Globe}
                      title={`Show All Accounts${allAccountsMode ? " (current)" : ""}`}
                      shortcut={{ modifiers: ["cmd"], key: "0" }}
                      onAction={switchToAllAccounts}
                    />
                    {accounts.slice(0, ACCOUNT_SHORTCUT_KEYS.length).map((account, index) => (
                      <Action
                        key={account.id}
                        icon={Icon.Person}
                        title={`Show ${account.name}${!allAccountsMode && account.id === selectedAccount?.id ? " (current)" : ""}`}
                        shortcut={{ modifiers: ["cmd"], key: ACCOUNT_SHORTCUT_KEYS[index] }}
                        onAction={() => switchToAccount(account.id)}
                      />
                    ))}
                  </ActionPanel.Section>
                )}
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

const iconForMaskedEmail: (maskedEmail: MaskedEmail) => Image = (maskedEmail) => {
  switch (maskedEmail.state) {
    case MaskedEmailState.Pending:
      return { source: Icon.Pause, tintColor: Color.Blue };

    case MaskedEmailState.Deleted:
      return { source: Icon.Trash, tintColor: Color.Red };

    case MaskedEmailState.Enabled:
      return { source: Icon.Check, tintColor: Color.Green };

    case MaskedEmailState.Disabled:
      return { source: Icon.Stop, tintColor: Color.Orange };
  }
};

const accessoryForMaskedEmail: (maskedEmail: MaskedEmail) => List.Item.Accessory = (maskedEmail) => {
  let color: Color;
  let value: string;

  switch (maskedEmail.state) {
    case MaskedEmailState.Pending:
      color = Color.Blue;
      value = "Pending";
      break;

    case MaskedEmailState.Deleted:
      color = Color.Red;
      value = "Deleted";
      break;

    case MaskedEmailState.Enabled:
      color = Color.Green;
      value = "Active";
      break;

    case MaskedEmailState.Disabled:
      color = Color.Orange;
      value = "Blocked";
      break;
  }

  // `tag` is documented but appears to be missing in the TypeScript types.
  // We're using tag here instead of text because tag changes both the text
  // color to the provided color and sets a transparent background with the
  // same color. Whereas text only sets the text color. We add a `null` tooltip
  // to make TypeScript happy.
  return { tag: { value, color }, tooltip: null };
};
