import { Action, ActionPanel, Color, Icon, Image, List, Toast, showToast } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccounts } from "./accounts";
import { MaskedEmail, MaskedEmailState, updateMaskedEmailState, retrieveAllMaskedEmails } from "./fastmail";
import { getToken } from "./token-store";

type MaskedEmailStateFilter = MaskedEmailState | "";

export default function Command() {
  const { accounts, selectedAccount, selectAccount, isLoading: accountsLoading } = useAccounts();
  const [maskedEmails, setMaskedEmails] = useState<MaskedEmail[]>([]);
  const [filter, setFilter] = useState<MaskedEmailStateFilter>("");
  const [emailsLoading, setEmailsLoading] = useState(false);

  const loadEmails = useCallback(async (accountId: string) => {
    setEmailsLoading(true);
    try {
      const token = await getToken(accountId);
      if (!token) throw new Error("No token available for this account.");
      const emails = await retrieveAllMaskedEmails(token);
      setMaskedEmails(emails);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load masked emails",
        message: error instanceof Error ? error.message : "Check your account token and try again.",
      });
      setMaskedEmails([]);
    } finally {
      setEmailsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedAccount) {
      loadEmails(selectedAccount.id);
    }
  }, [selectedAccount, loadEmails]);

  const handleDropdownChange = (value: string) => {
    if (value.startsWith("account:")) {
      selectAccount(value.slice("account:".length));
      setFilter("");
    } else if (value.startsWith("state:")) {
      setFilter(value.slice("state:".length) as MaskedEmailStateFilter);
    }
  };

  const updateMaskedEmail = async (email: MaskedEmail, state: MaskedEmailState) => {
    if (!selectedAccount) throw new Error("No account selected");
    const token = await getToken(selectedAccount.id);
    if (!token) throw new Error("No token available for the selected account.");
    await updateMaskedEmailState(token, email, state);
    setMaskedEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, state } : e)));
  };

  const toggleMaskedEmail = async (email: MaskedEmail) => {
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

  const deleteMaskedEmail = async (email: MaskedEmail) => {
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

  const restoreMaskedEmail = async (email: MaskedEmail) => {
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

  return (
    <List
      isLoading={accountsLoading || emailsLoading}
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter"
          onChange={handleDropdownChange}
        >
          {accounts.length > 1 && (
            <List.Dropdown.Section title="Account">
              {accounts.map((account) => (
                <List.Dropdown.Item
                  key={account.id}
                  title={account.name}
                  value={`account:${account.id}`}
                />
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
      {filteredSortedMaskedEmails.map((email) => {
        const canBlockUnblock = [MaskedEmailState.Enabled, MaskedEmailState.Disabled].includes(email.state);
        const canRestore = email.state === MaskedEmailState.Deleted;
        const canView = email.state !== MaskedEmailState.Pending;

        return (
          <List.Item
            icon={iconForMaskedEmail(email)}
            key={email.id}
            title={email.email}
            subtitle={email.forDomain || email.description}
            keywords={[email.description, email.forDomain]}
            accessories={[
              { date: new Date(email.createdAt), tooltip: `Created ${new Date(email.createdAt).toLocaleString()}` },
              accessoryForMaskedEmail(email),
            ]}
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
