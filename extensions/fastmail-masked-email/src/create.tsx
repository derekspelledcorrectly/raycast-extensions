import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  Form,
  Icon,
  PopToRootType,
  Toast,
  closeMainWindow,
  getPreferenceValues,
  showHUD,
  showToast,
} from "@raycast/api";
import { useState } from "react";
import { useAccounts } from "./accounts";
import { createMaskedEmail } from "./fastmail";
import { getToken } from "./token-store";

type Preferences = {
  create_prefix: string;
};

type FormValues = {
  account?: string;
  prefix: string;
  description: string;
  domain: string;
};

export default function Command() {
  const [maskedEmail, setMaskedEmail] = useState<string>("");
  const { accounts, selectedAccount, selectAccount, isLoading } = useAccounts();
  const { create_prefix } = getPreferenceValues<Preferences>();

  if (!isLoading && accounts.length === 0) {
    return (
      <Detail markdown='No Fastmail accounts configured. Use the **"Manage Fastmail Accounts"** command to add one.' />
    );
  }

  const resolveToken = async (accountId: string | undefined): Promise<string | undefined> => {
    const id = accountId ?? selectedAccount?.id;
    if (!id) return undefined;
    return getToken(id);
  };

  const handleSubmit = async ({ account, prefix, description, domain }: FormValues) => {
    const token = await resolveToken(account);
    if (!token) {
      await showToast({ style: Toast.Style.Failure, title: "No account selected" });
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: "Creating masked email..." });

    try {
      const email = await createMaskedEmail(token, prefix, description, domain);

      Clipboard.copy(email);

      await showHUD(`🎉 Masked email copied to clipboard`);

      await closeMainWindow({ clearRootSearch: true, popToRootType: PopToRootType.Immediate });
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to create masked email";
      toast.message =
        error instanceof Error
          ? error.message
          : "An error occurred while creating the masked email, please try again later";
    }
  };

  const handleSubmitInteractive = async ({ account, prefix, description, domain }: FormValues) => {
    const token = await resolveToken(account);
    if (!token) {
      await showToast({ style: Toast.Style.Failure, title: "No account selected" });
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: "Creating masked email..." });

    try {
      const email = await createMaskedEmail(token, prefix, description, domain);

      setMaskedEmail(email);

      Clipboard.copy(email);

      toast.style = Toast.Style.Success;
      toast.title = "Masked email copied to clipboard";
      toast.message = email;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to create masked email";
      toast.message =
        error instanceof Error
          ? error.message
          : "An error occurred while creating the masked email, please try again later";
    }
  };

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Masked Email" icon={Icon.EyeDisabled} onSubmit={handleSubmit} />
          <Action.SubmitForm
            title="Create Masked Email Interactively"
            icon={Icon.EyeDisabled}
            onSubmit={handleSubmitInteractive}
          />
        </ActionPanel>
      }
    >
      {accounts.length > 1 && (
        <Form.Dropdown
          id="account"
          title="Account"
          defaultValue={selectedAccount?.id}
          onChange={selectAccount}
        >
          {accounts.map((account) => (
            <Form.Dropdown.Item key={account.id} title={account.name} value={account.id} />
          ))}
        </Form.Dropdown>
      )}
      <Form.TextField
        id="prefix"
        title="Prefix (Optional)"
        placeholder="Prefix to use for this masked email"
        defaultValue={create_prefix}
        info={`If you have configured a default prefix in the preferences, it will be used here. If you leave this field empty, no prefix will be used.

A prefix must be <= 64 characters in length and only contain characters a-z, 0-9 and _ (underscore)`}
      />
      <Form.TextField
        id="description"
        title="Description (Optional)"
        placeholder="What is this masked email for?"
        autoFocus={true}
      />
      <Form.TextField id="domain" title="Domain (Optional)" placeholder="What is the domain for this masked email?" />
      {maskedEmail && (
        <>
          <Form.Description text={`\n${maskedEmail}\n`} />
          <Form.Description
            text={`This masked email is currently in the pending state and will be automatically deleted after 24 hours if not used`}
          />
          <Form.Description text={`Use ⇧⌘⏎ to generate a new masked email`} />
        </>
      )}
    </Form>
  );
}
