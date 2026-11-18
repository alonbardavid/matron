import { Modal } from "@mantine/core";
import { z } from "zod";
import { useForm } from "@frontend/ds/forms/context";
import { FormGeneralErrors } from "@frontend/ds/forms/FormGeneralErrors";
import {
  FormPasswordInput,
  FormSelect,
  FormTextInput,
} from "@frontend/ds/forms/FormInputs";
import { FormSubmitButton } from "@frontend/ds/forms/FormSubmitButton";
import { StandardForm } from "@frontend/ds/forms/StandardForm";
import { ROLES, type Role } from "../useMe";

const memberSchema = z.object({
  name: z.string().trim().min(1, "Enter a name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  role: z.enum(ROLES),
});
type MemberValues = z.infer<typeof memberSchema>;

export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
];

interface NewMemberModalProps {
  opened: boolean;
  onClose: () => void;
  onCreate: (values: MemberValues) => Promise<void>;
}

export function NewMemberModal({ opened, onClose, onCreate }: NewMemberModalProps) {
  const form = useForm<MemberValues>({
    initialValues: { name: "", email: "", password: "", role: "member" },
    schema: memberSchema,
  });

  const submit = async (values: MemberValues) => {
    await onCreate(values);
    form.reset();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Add a user" centered>
      <StandardForm form={form} onSubmit={submit}>
        <FormTextInput name="name" label="Name" autoComplete="off" data-autofocus />
        <FormTextInput name="email" label="Email" type="email" autoComplete="off" />
        <FormPasswordInput name="password" label="Password" autoComplete="new-password" />
        <FormSelect name="role" label="Role" data={ROLE_OPTIONS} allowDeselect={false} />
        <FormGeneralErrors />
        <FormSubmitButton mt="xs">Add user</FormSubmitButton>
      </StandardForm>
    </Modal>
  );
}
